// The field-recording voice: one recording the server decoded, played in passes that crossfade
// into each other, through a high-pass, a low-pass and a panner (decision 0029). A pass replays
// one span of the file (`loop`) or a span from a seeded place in it (`scatter`). The passes are
// computed in JS for each window's frames, as the noise bed's noise is, so an excerpt plays
// exactly what a full render plays there.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Recording, Samples, VoiceSetup, VoiceWindow } from "./render.js" */
import { eventCost, SWEPT_FILTER_WEIGHT } from "./cost-unit.js";
import { choice, number, recording } from "./descriptor.js";
import { MACRO } from "./macro-table.js";
import { drawer } from "./prng.js";
import { WINDOW } from "./render.js";
import { playWindowBuffer } from "./window-buffer.js";

const MODES = Object.freeze(["loop", "scatter"]);

const PARAMS = Object.freeze({
  recording: recording({ description: "file to play, listed below" }),
  mode: choice({
    values: MODES,
    default: "loop",
    description: "each pass replays one span, or a span from a seeded place",
  }),
  position: number({
    min: 0,
    max: 1,
    default: 0,
    unit: "",
    description: "span start, share of the file",
    when: {
      applies: ({ mode }) => (mode === undefined ? undefined : mode === "loop"),
      text: 'with mode "loop"',
    },
  }),
  span: number({
    min: 1,
    max: 120,
    default: 20,
    unit: "s",
    scale: "log",
    description: "file seconds a pass plays, at most the file",
  }),
  fade: number({
    min: 0.02,
    max: 0.5,
    default: 0.25,
    unit: "",
    description: "crossfade, share of a pass",
  }),
  rate: number({
    min: 0.25,
    max: 2,
    default: 1,
    unit: "x",
    scale: "log",
    description: "playback speed and pitch",
  }),
  lowcut: number({
    min: 20,
    max: 2000,
    default: 20,
    unit: "Hz",
    scale: "log",
    description: "high-pass corner",
  }),
  cutoff: number({
    min: 100,
    max: 20000,
    default: 20000,
    unit: "Hz",
    scale: "log",
    trajectory: true,
    description: "low-pass corner",
  }),
  pan: number({
    min: -1,
    max: 1,
    default: 0,
    unit: "",
    trajectory: true,
    description: "balance",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS> & { id: string }} RecordingVoice */

/** Channels a recording may have; the voice plays a mono file in both. */
const MAX_RECORDING_CHANNELS = 2;
/** Shortest recording the voice plays, in seconds, so every pass is several frames long. */
const MIN_RECORDING_SECONDS = 0.1;
/**
 * Longest recording the voice plays: a render holds the whole file decoded, 384 kB a second
 * in stereo at 48 kHz, so 20 minutes is 461 MB beside the render's own 1.5 GiB ceiling
 * (decision 0010).
 */
const MAX_RECORDING_SECONDS = 1200;

/**
 * Why the voice can't play a recording of this shape, or null when it can. The server checks
 * a file before decoding it, and the prompt lists only files it can play.
 * @param {{ channels: number; duration: number }} recording duration in seconds
 * @returns {string | null}
 */
export function unplayable({ channels, duration }) {
  if (channels > MAX_RECORDING_CHANNELS) {
    return `it has ${channels} channels, and the voice plays 1 or 2`;
  }
  if (duration > MAX_RECORDING_SECONDS) {
    return `it is ${duration} s long, over the ${MAX_RECORDING_SECONDS} s the voice plays`;
  }
  if (duration < MIN_RECORDING_SECONDS) {
    return `it is ${duration} s long, under the ${MIN_RECORDING_SECONDS} s the voice plays`;
  }
  return null;
}

/** Slot of a scatter pass's place in the file; pass k draws `(seed, voice id, k, slot)`. */
const POSITION_SLOT = 1;

/** A Butterworth response, as the dB Q Web Audio reads for a low-pass or high-pass. */
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

/**
 * Computing the passes in JS costs render time the node count doesn't show: 2.0 ms a timeline
 * second with two passes always overlapping at rate 2, measured on mbp2021 over 120 s, about 16
 * node-seconds at 1.24e-4 s each (decision 0029).
 */
const PASS_WEIGHT = 16;

/**
 * The recording a voice plays, checked for what the voice needs.
 * @param {Samples} samples
 * @param {string} hash
 * @param {string} voiceId
 * @param {number} sampleRate
 * @returns {Recording}
 */
function requireRecording(samples, hash, voiceId, sampleRate) {
  const found = Object.hasOwn(samples, hash) ? samples[hash] : undefined;
  const where = `render: voice "${voiceId}" plays recording ${hash}`;
  if (!found) throw new Error(`${where}, which isn't in samples`);
  if (found.sampleRate !== sampleRate) {
    throw new Error(`${where} at ${found.sampleRate} Hz; decode it at ${sampleRate} Hz`);
  }
  const count = found.channels.length;
  if (count < 1 || count > MAX_RECORDING_CHANNELS) {
    throw new Error(`${where}, which has ${count} channels; it plays 1 or 2`);
  }
  const frames = /** @type {Float32Array} */ (found.channels[0]).length;
  if (found.channels.some((c) => c.length !== frames)) {
    throw new Error(`${where}, whose channels differ in length`);
  }
  if (frames < MIN_RECORDING_SECONDS * sampleRate) {
    throw new Error(`${where}, which is under ${MIN_RECORDING_SECONDS} s`);
  }
  return found;
}

/**
 * The passes' layout in timeline frames, from the voice's first frame.
 * @param {RecordingVoice} voice
 * @param {number} fileFrames
 * @param {number} sampleRate
 */
function passLayout(voice, fileFrames, sampleRate) {
  const span = Math.min(Math.round(voice.span * sampleRate), fileFrames);
  // A pass's last frame reads file frame span - 1 at most.
  const length = Math.floor((span - 1) / voice.rate) + 1;
  // At most half the pass, so a pass's fade-in and fade-out never overlap.
  const fade = Math.floor(voice.fade * length);
  return { first: Math.ceil(voice.start * sampleRate), span, length, fade, hop: length - fade };
}

/**
 * Adds `gain(i) × file(from + i × rate)` to `sum` at `out + i` for i in [lo, hi), the file read
 * by 4-point Catmull-Rom interpolation, holding its end samples past either end. A whole frame
 * reads the sample itself.
 * @param {Float64Array} sum
 * @param {Float32Array} data
 * @param {{ from: number; rate: number; lo: number; hi: number; out: number;
 *   gain: (i: number) => number }} pass
 */
function addPass(sum, data, { from, rate, lo, hi, out, gain }) {
  const last = data.length - 1;
  for (let i = lo; i < hi; i++) {
    const at = from + i * rate;
    const x = Math.floor(at);
    const t = at - x;
    const y1 = /** @type {number} */ (data[Math.min(Math.max(x, 0), last)]);
    let value = y1;
    if (t !== 0) {
      const y0 = /** @type {number} */ (data[Math.min(Math.max(x - 1, 0), last)]);
      const y2 = /** @type {number} */ (data[Math.min(x + 1, last)]);
      const y3 = /** @type {number} */ (data[Math.min(x + 2, last)]);
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      value = ((c3 * t + c2) * t + c1) * t + y1;
    }
    sum[out + i] = /** @type {number} */ (sum[out + i]) + gain(i) * value;
  }
}

/**
 * The voice's stereo sound for timeline frames `[first, first + frames)`, before its filters,
 * the same whichever window or render computes it. Pass k starts `k × hop` frames after the
 * voice's first frame and fades in and out with equal-power curves, so two passes sum to a
 * steady level where they overlap.
 * @param {{ recording: Recording; voice: RecordingVoice; seed: number; first: number;
 *   frames: number; sampleRate: number }} where
 * @returns {Float32Array<ArrayBuffer>[]} left and right
 */
export function recordingChunk({ recording: file, voice, seed, first, frames, sampleRate }) {
  const sources = /** @type {Float32Array[]} */ (file.channels);
  const fileFrames = /** @type {Float32Array} */ (sources[0]).length;
  const layout = passLayout(voice, fileFrames, sampleRate);
  const room = fileFrames - layout.span;
  const place = drawer(seed, voice.id);
  /** @type {Float64Array[]} */
  const sums = sources.map(() => new Float64Array(frames));
  const firstPass = Math.max(0, Math.ceil((first - layout.first - layout.length + 1) / layout.hop));
  const lastPass = Math.floor((first + frames - 1 - layout.first) / layout.hop);
  for (let k = firstPass; k <= lastPass; k++) {
    const u = voice.mode === "loop" ? (voice.position ?? 0) : place(k, POSITION_SLOT);
    const from = Math.round(u * room);
    const start = layout.first + k * layout.hop;
    const { fade, length } = layout;
    const fadeOut = length - fade;
    /** @param {number} i */
    const gain = (i) =>
      i < fade
        ? Math.sin((Math.PI / 2) * ((i + 0.5) / fade))
        : i >= fadeOut
          ? Math.cos((Math.PI / 2) * ((i - fadeOut + 0.5) / fade))
          : 1;
    const pass = {
      from,
      rate: voice.rate,
      lo: Math.max(0, first - start),
      hi: Math.min(length, first + frames - start),
      out: start - first,
      gain,
    };
    for (const [c, data] of sources.entries()) {
      addPass(/** @type {Float64Array} */ (sums[c]), data, pass);
    }
  }
  // A mono file plays the same in both channels.
  if (sources.length === 1) sums.push(/** @type {Float64Array} */ (sums[0]));
  return sums.map((sum) => Float32Array.from(sum));
}

/** The low-pass, the high-pass, the panner, one buffer source a window, and the passes. */
const cost = () =>
  SWEPT_FILTER_WEIGHT +
  2 +
  eventCost({ rate: 1 / WINDOW, seconds: WINDOW, nodes: 1 }) +
  PASS_WEIGHT;

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, voice, seed, from, startFrame, at, automate, samples }) {
  const played = /** @type {RecordingVoice} */ (/** @type {unknown} */ (voice));
  const rate = ctx.sampleRate;
  const file = requireRecording(samples, played.recording, voice.id, rate);

  const lowcut = ctx.createBiquadFilter();
  lowcut.type = "highpass";
  lowcut.frequency.value = played.lowcut;
  lowcut.Q.value = BUTTERWORTH_Q_DB;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.value = BUTTERWORTH_Q_DB;
  const panner = ctx.createStereoPanner();
  lowcut.connect(lowpass).connect(panner).connect(output);
  automate(lowpass.frequency, (self) => /** @type {number} */ (self.cutoff));
  automate(panner.pan, (self) => /** @type {number} */ (self.pan));

  return (windowFrom, windowTo) => {
    if (Math.max(windowFrom, played.start) >= Math.min(windowTo, played.end)) return;
    const first = Math.round(windowFrom * rate);
    const frames = Math.round(windowTo * rate) - first;
    const channels = recordingChunk({
      recording: file,
      voice: played,
      seed,
      first,
      frames,
      sampleRate: rate,
    });
    playWindowBuffer({ ctx, channels, first, startFrame, startTime: at(from), into: lowcut });
  };
}

export const fieldRecording = {
  type: "recording",
  description: "a field recording in crossfaded passes, filtered and panned",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([{ macro: MACRO.brightness, param: "cutoff", depth: 0.25 }]),
  /** Its passes come from timeline frames, so a pass that started earlier plays its rest. */
  longestEvent: () => 0,
  cost,
  build,
};

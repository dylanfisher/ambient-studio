// The chant voice: a low sung drone. Harmonics of a root, up to about 3 kHz and falling `tilt` dB
// an octave, are shaped by a vowel's resonances and swell in level at `pulse` Hz. The partials
// are computed in JS and mixed into one stereo buffer per event window, as the granular cloud
// does (decision 0014), with their phase taken from timeline time (decision 0069).
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { CONTROL_RATE, controlTime } from "./control-grid.js";
import { eventCost } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { number } from "./descriptor.js";
import { drone, droneFundamental } from "./drone.js";
import { effectiveParams } from "./effective-params.js";
import { MACRO } from "./macro-table.js";
import { resolvePitch } from "./pitch.js";
import { WINDOW } from "./render.js";
import { centsToRatio } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";
import { playWindowBuffer } from "./window-buffer.js";

const PARAMS = Object.freeze({
  // The drone's register, because the root snaps to a scale note as the drone's does.
  root: number({
    min: drone.params.root.min,
    max: drone.params.root.max,
    default: 65,
    unit: "Hz",
    scale: "log",
    safe: [50, 85],
    description: drone.params.root.description,
  }),
  vowel: number({
    min: 0,
    max: 1,
    default: 0.2,
    unit: "",
    trajectory: true,
    description: "oo 0, oh 0.5, ah 1",
  }),
  focus: number({
    min: 0,
    max: 18,
    default: 6,
    unit: "dB",
    trajectory: true,
    safe: [0, 12],
    description: "boost at upper formant",
  }),
  tilt: number({
    min: 0,
    max: 12,
    default: 3,
    unit: "dB",
    safe: [2, 6],
    description: "per harmonic octave",
  }),
  bend: number({
    min: -200,
    max: 200,
    default: 0,
    unit: "cents",
    trajectory: true,
    safe: [-100, 100],
    description: "pitch drift",
  }),
  pulse: number({
    min: 0.1,
    max: 1.5,
    default: 0.38,
    unit: "Hz",
    scale: "log",
    safe: [0.2, 0.8],
    description: "swell rate",
  }),
  depth: number({
    min: 0,
    max: 1,
    default: 0.5,
    unit: "",
    trajectory: true,
    description: "swell depth",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} ChantVoice */

/** Harmonics of the snapped root up to this; a bend of +200 cents takes the top one to 3.4 kHz. */
const TOP_HZ = 3000;

/**
 * The two vowel resonances at vowel 0, 0.5 and 1, a dark "oo", an "oh" and an open "ah" of a low
 * voice: centers and bandwidths in Hz. Between targets, centers and bandwidths move
 * geometrically. At a 65 Hz root the lower one lifts harmonic 5 at vowel 0, 7 at 0.5 and 10 at 1.
 */
const VOWELS = Object.freeze([
  { lower: { hz: 300, width: 160 }, upper: { hz: 650, width: 200 } },
  { lower: { hz: 460, width: 180 }, upper: { hz: 780, width: 220 } },
  { lower: { hz: 650, width: 200 }, upper: { hz: 1000, width: 240 } },
]);
/** The upper resonance's peak against the lower one's. */
const UPPER_DB = -10;
/**
 * A third, broad and weak resonance at the bottom of the register, fixed for every vowel. It sets
 * the fundamental at about 19 dB under the strongest partial at the default tilt.
 */
const CHEST = Object.freeze({ hz: 100, width: 140, db: -25 });
/**
 * The source's RMS before the voice's level and pan, whatever the vowel. A default chant measures
 * 0.3 LU under a default drone at the same level (seed 1, 1 s reverb).
 */
const SOURCE_RMS = 0.9;
/** The swell's dip at depth 1, dB. */
const SWELL_DB = 12;

/**
 * The power response of a band-pass resonance at `hz`, 1 at its center and falling 12 dB an
 * octave far from it, so the partials between and beyond the resonances drop away quickly.
 * @param {number} f Hz
 * @param {{ hz: number; width: number }} resonance
 */
function resonance(f, { hz, width }) {
  const off = (hz / width) * (f / hz - hz / f);
  return 1 / (1 + off * off);
}

/**
 * The vowel's resonances at `vowel`, between its two nearest targets.
 * @param {number} vowel 0 to 1
 */
function vowelResonances(vowel) {
  const at = vowel * (VOWELS.length - 1);
  const i = Math.min(VOWELS.length - 2, Math.floor(at));
  const u = at - i;
  const a = /** @type {(typeof VOWELS)[number]} */ (VOWELS[i]);
  const b = /** @type {(typeof VOWELS)[number]} */ (VOWELS[i + 1]);
  /** @param {"lower" | "upper"} which */
  const blend = (which) => ({
    hz: a[which].hz * (b[which].hz / a[which].hz) ** u,
    width: a[which].width * (b[which].width / a[which].width) ** u,
  });
  return { lower: blend("lower"), upper: blend("upper") };
}

/**
 * Fills `out` with the amplitudes of harmonics 1 to `out.length` of `hz`, scaled so their sum of
 * sines has an RMS of `SOURCE_RMS`. `focus` lifts the harmonic nearest the upper resonance, or
 * shares the lift between the two either side of it, so it moves smoothly as the vowel does.
 * @param {Float64Array} out
 * @param {{ hz: number; vowel: number; focus: number; tilt: number }} at
 */
export function partialAmplitudes(out, { hz, vowel, focus, tilt }) {
  const { lower, upper } = vowelResonances(vowel);
  const upperGain = dbToGain(UPPER_DB);
  const chestGain = dbToGain(CHEST.db);
  let power = 0;
  for (let i = 0; i < out.length; i++) {
    const n = i + 1;
    const f = n * hz;
    const near = Math.max(0, 1 - Math.abs(f - upper.hz) / hz);
    const shape =
      resonance(f, lower) + upperGain * resonance(f, upper) + chestGain * resonance(f, CHEST);
    const amplitude = dbToGain(-tilt * Math.log2(n) + focus * near) * shape;
    out[i] = amplitude;
    power += (amplitude * amplitude) / 2;
  }
  const scale = SOURCE_RMS / Math.sqrt(power);
  for (let i = 0; i < out.length; i++) out[i] = /** @type {number} */ (out[i]) * scale;
}

/**
 * @typedef {object} ChantControl
 * @property {number} hz the bent fundamental
 * @property {number} vowel
 * @property {number} focus
 * @property {number} depth
 */

/**
 * @typedef {object} ChantTrack
 * @property {number} sampleRate
 * @property {number} count harmonics a singer sings
 * @property {number} tilt
 * @property {number} pulse
 * @property {(k: number) => ChantControl} control the effective values at control-grid sample k
 * @property {(k: number) => number} turns cycles the fundamental, before a singer's detune,
 *   has turned from timeline 0 to grid sample k
 */

/**
 * The voice's control values on the 0.1 s grid, and its fundamental's phase, both from timeline
 * 0. The phase sums the fundamental's frequency over the grid from 0 in one order, so a track
 * that starts late, as an excerpt's does, reaches the same value at each sample bit for bit.
 * Samples are computed as they are first asked for and kept.
 * @param {Genome} genome
 * @param {Voice} voice
 * @param {number} sampleRate a whole number of frames a control-grid step
 * @returns {ChantTrack}
 */
export function chantTrack(genome, voice, sampleRate) {
  if (!Number.isInteger(sampleRate / CONTROL_RATE)) {
    throw new Error(`chant: ${sampleRate} Hz is not a whole number of frames a control step`);
  }
  const index = genome.voices.findIndex((v) => v.id === voice.id);
  if (index === -1) throw new Error(`chant: the genome has no voice "${voice.id}"`);
  const self = /** @type {ChantVoice} */ (/** @type {unknown} */ (voice));
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const fundamental = droneFundamental(pitch, self.root);
  /** @type {ChantControl[]} */
  const controls = [];
  const turns = [0];
  /** @param {number} k */
  const control = (k) => {
    while (controls.length <= k) {
      const values = /** @type {Resolved<ChantVoice>} */ (
        /** @type {unknown} */ (effectiveParams(genome, controlTime(controls.length)).voices[index])
      );
      controls.push({
        hz: fundamental * centsToRatio(values.bend),
        vowel: values.vowel,
        focus: values.focus,
        depth: values.depth,
      });
    }
    return /** @type {ChantControl} */ (controls[k]);
  };
  return {
    sampleRate,
    count: Math.floor(TOP_HZ / fundamental),
    tilt: self.tilt,
    pulse: self.pulse,
    control,
    turns: (k) => {
      // The frequency ramps linearly between grid samples, so each step adds its mean.
      while (turns.length <= k) {
        const j = turns.length - 1;
        const step = (control(j).hz + control(j + 1).hz) / (2 * CONTROL_RATE);
        turns.push(/** @type {number} */ (turns[j]) + step);
      }
      return /** @type {number} */ (turns[k]);
    },
  };
}

/**
 * @typedef {object} Singer
 * @property {number} cents detune from the track's pitch
 * @property {number} pan -1 to 1, equal-power
 */

/** The one singer: undetuned and centered. */
const SOLO = Object.freeze({ cents: 0, pan: 0 });

/**
 * Adds a singer's voice to `channels`, which start at timeline frame `first`. Each frame's value
 * depends only on the track and the frame: amplitudes are interpolated between grid samples
 * from the frame's place between them, not accumulated, so any window computes the same bits.
 * Harmonic n's sine comes from the recurrence sin((n+1)θ) = 2cos θ sin(nθ) − sin((n−1)θ), one
 * sine and one cosine a frame for all of them.
 * @param {Float32Array[]} channels left and right
 * @param {Singer} singer
 * @param {ChantTrack} track
 * @param {number} first
 */
function addSinger(channels, { cents, pan }, track, first) {
  const [left, right] = /** @type {[Float32Array, Float32Array]} */ (channels);
  const { sampleRate, count, tilt, pulse } = track;
  const ratio = centsToRatio(cents);
  const angle = ((pan + 1) * Math.PI) / 4;
  const toLeft = Math.cos(angle);
  const toRight = Math.sin(angle);
  const step = sampleRate / CONTROL_RATE;
  const end = first + left.length;
  let from = new Float64Array(count);
  let to = new Float64Array(count);
  const slope = new Float64Array(count);
  /** @param {Float64Array} out @param {ChantControl} c */
  const amplitudes = (out, c) =>
    partialAmplitudes(out, { hz: c.hz * ratio, vowel: c.vowel, focus: c.focus, tilt });
  const k0 = Math.floor(first / step);
  amplitudes(from, track.control(k0));
  for (let k = k0; k * step < end; k++) {
    const a = track.control(k);
    const b = track.control(k + 1);
    amplitudes(to, b);
    for (let n = 0; n < count; n++)
      slope[n] = /** @type {number} */ (to[n]) - /** @type {number} */ (from[n]);
    const turns = track.turns(k);
    const rise = b.hz - a.hz;
    for (let i = Math.max(first, k * step); i < Math.min(end, (k + 1) * step); i++) {
      const u = (i - k * step) / step;
      const tau = u / CONTROL_RATE;
      // The phase of a frequency ramping from a.hz to b.hz over the step.
      const cycles = ratio * (turns + a.hz * tau + (rise * tau * u) / 2);
      const theta = 2 * Math.PI * (cycles - Math.floor(cycles));
      const twoCos = 2 * Math.cos(theta);
      let below = 0;
      let sine = Math.sin(theta);
      let sum = 0;
      for (let n = 0; n < count; n++) {
        const amplitude = /** @type {number} */ (from[n]) + /** @type {number} */ (slope[n]) * u;
        sum += amplitude * sine;
        const above = twoCos * sine - below;
        below = sine;
        sine = above;
      }
      const depth = a.depth + (b.depth - a.depth) * u;
      const dip = 0.5 + 0.5 * Math.cos((2 * Math.PI * pulse * i) / sampleRate);
      const value = sum * dbToGain(-SWELL_DB * depth * dip);
      const out = i - first;
      left[out] = /** @type {number} */ (left[out]) + toLeft * value;
      right[out] = /** @type {number} */ (right[out]) + toRight * value;
    }
    [from, to] = [to, from];
  }
}

/**
 * The voice's stereo sound for timeline frames `[first, first + frames)`, before its level.
 * @param {ChantTrack} track
 * @param {number} first
 * @param {number} frames
 * @returns {Float32Array<ArrayBuffer>[]} left and right
 */
export function chantChunk(track, first, frames) {
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  addSinger(channels, SOLO, track, first);
  return channels;
}

/**
 * Computing the voice in JS costs render time the node count doesn't show, in node-seconds at
 * 1.24e-4 s each. Measured on mbp2021 over 120 s renders beside a noise bed's known cost, a
 * singer took 0.94 to 7.4 ms a timeline second for 22 to 81 partials: about 0.11 ms a partial
 * (0.9 node-seconds) and 2.9 ms a singer for the frame's sine, cosine and swell and the control
 * samples (23 node-seconds) (decision 0069).
 */
const PARTIAL_WEIGHT = 0.9;
const SINGER_WEIGHT = 23;

/**
 * One buffer source a window, plus the JS mixing of every partial the singer sings.
 * @param {Voice} voice
 * @param {Genome} genome
 */
function cost(voice, genome) {
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const root = /** @type {ChantVoice} */ (/** @type {unknown} */ (voice)).root;
  const count = Math.floor(TOP_HZ / droneFundamental(pitch, root));
  return (
    eventCost({ rate: 1 / WINDOW, seconds: WINDOW, nodes: 1 }) +
    SINGER_WEIGHT +
    PARTIAL_WEIGHT * count
  );
}

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, genome, voice, from, startFrame, at }) {
  const rate = ctx.sampleRate;
  const track = chantTrack(genome, voice, rate);
  return (windowFrom, windowTo) => {
    if (Math.max(windowFrom, voice.start) >= Math.min(windowTo, voice.end)) return;
    const first = Math.round(windowFrom * rate);
    const channels = chantChunk(track, first, Math.round(windowTo * rate) - first);
    playWindowBuffer({ ctx, channels, first, startFrame, startTime: at(from), into: output });
  };
}

export const chant = {
  type: "chant",
  description: "low sung voice: harmonics, vowel formants, swell",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    { macro: MACRO.brightness, param: "vowel", depth: 0.25 },
    { macro: MACRO.motion, param: "depth", depth: 0.25 },
  ]),
  /** Its partials' phase comes from timeline time. */
  longestEvent: () => 0,
  cost,
  build,
};

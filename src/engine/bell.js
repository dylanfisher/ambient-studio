// The bell: struck notes at random times, thinned from a fine grid at the density of the moment
// (decision 0003), each note computed into a buffer from the seed and played by one
// AudioBufferSource and a gain (decision 0013). Additive partials are the main model, drawn from
// the scale in an absolute tuning and from a ratio table otherwise; FM and a plucked string
// are the others. At most eight notes sound at once: the oldest fades out as a ninth starts.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { Partial } from "./bell-notes.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Pitch } from "./pitch.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { additiveTone, fmTone, pluckTone, shapeNote } from "./bell-notes.js";
import { eventCost } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { choice, int, number } from "./descriptor.js";
import { effectiveParams } from "./effective-params.js";
import { eventSlots } from "./event-slots.js";
import { highestValue } from "./highest-value.js";
import { MACRO } from "./macro-table.js";
import { resolvePitch, tuningFrequencies } from "./pitch.js";
import { draw, fires } from "./prng.js";
import { centsToRatio, isAbsolute } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";

const PARAMS = Object.freeze({
  model: choice({
    values: ["additive", "fm", "pluck"],
    default: "additive",
    description: "synthesis",
  }),
  density: number({
    min: 0.5,
    max: 40,
    default: 8,
    unit: "/min",
    scale: "log",
    trajectory: true,
    safe: [0.5, 8],
    description: "notes",
  }),
  decay: number({
    min: 0.3,
    max: 15,
    default: 6,
    unit: "s",
    scale: "log",
    safe: [2, 10],
    description: "ring",
  }),
  partials: int({ min: 4, max: 10, default: 6, unit: "", safe: [4, 6], description: "≤3 kHz" }),
  fall: number({
    min: 3,
    max: 6,
    default: 4.5,
    unit: "dB",
    trajectory: true,
    safe: [4.5, 6],
    description: "per partial",
  }),
  ratios: choice({
    values: ["bar", "harmonic"],
    default: "bar",
    description: "partial set; absolute tuning: scale",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} BellVoice */

/** Seconds between note candidates; each fires with probability density × STEP / 60. */
const STEP = 0.25;
/** The register fundamentals come from, in Hz. */
const BAND = Object.freeze({ lo: 150, hi: 1100 });
/** No partial goes above this, in Hz. */
const TOP = 3000;
/** Most notes sounding at once. */
const MOST_NOTES = 8;
/** Seconds the oldest note takes to fade when a new one would go over the cap. */
const CUT_FADE = 0.05;
/** The highest partial's ring as a share of the lowest's; those between fall in geometric steps. */
const UPPER_RING = 0.5;
/** A note's peak before the voice's level, at full velocity. */
const NOTE_PEAK = 0.5;
/** Velocities spread this many dB down from full. */
const VELOCITY_DB = 9;
/** Pans spread this far either side of the center. */
const PAN_SPREAD = 0.6;
/** Linear attack in seconds at the lowest and highest `fall`: a darker strike is softer. */
const ATTACK = Object.freeze({ min: 0.002, max: 0.01 });

/** Partial frequency ratios in a relative tuning: a free bar's modes, and a sparse harmonic set. */
const RATIOS = Object.freeze({
  bar: [1, 2.756, 5.404, 8.933, 13.344, 18.64, 24.81, 31.87, 39.81, 48.64],
  harmonic: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5],
});

/**
 * Per-note draws (decision 0003): `phase` and `pick` take one slot per partial, `noise` one per
 * sample of a pluck's excitation, so each starts past the last slot the one before can use.
 */
const SLOT = Object.freeze({
  jitter: 1,
  pitch: 2,
  velocity: 3,
  pan: 4,
  detune: 5,
  phase: 6,
  pick: 6 + PARAMS.partials.max,
  noise: 6 + 2 * PARAMS.partials.max,
});

/**
 * Where `fall` sits in its range, from 0 (brightest) to 1 (darkest).
 * @param {number} fall
 */
const darkness = (fall) => (fall - PARAMS.fall.min) / (PARAMS.fall.max - PARAMS.fall.min);

/**
 * One note on the timeline.
 * @typedef {object} BellNote
 * @property {number} index the candidate slot on the voice's grid
 * @property {number} frame the timeline frame it starts on
 * @property {number} end the timeline frame it ends on: its ring's end, or where the cap cuts it
 * @property {boolean} cut whether the cap cuts it
 */

/**
 * Frames a note rings: the lowest partial's decay.
 * @param {number} decay seconds
 * @param {number} rate
 */
const ringFrames = (decay, rate) => Math.ceil(decay * rate);

/**
 * Finds the voice's notes from the seed and the density at each candidate's time. Candidates
 * sit every 0.25 s from timeline 0, each moved later by a drawn fraction of that step so notes
 * don't fall on a pulse. A note starts inside the voice's start and end.
 * @param {Genome} genome
 * @param {Voice} voice
 * @param {number} seed
 * @param {number} rate
 * @returns {(from: number, to: number) => BellNote[]} the notes starting from `from` to before
 *   `to`, timeline seconds
 */
function noteFinder(genome, voice, seed, rate) {
  const values = /** @type {BellVoice} */ (/** @type {unknown} */ (voice));
  const index = genome.voices.indexOf(voice);
  const ring = ringFrames(values.decay, rate);
  /** @type {Map<number, number | undefined>} candidate → its frame, if it fires */
  const fired = new Map();
  /** @param {number} k */
  function onset(k) {
    if (fired.has(k)) return fired.get(k);
    const self = /** @type {Resolved<BellVoice>} */ (
      /** @type {unknown} */ (effectiveParams(genome, k * STEP).voices[index])
    );
    const probability = Math.min(1, (self.density * STEP) / 60);
    let frame;
    if (fires(seed, voice.id, k, probability)) {
      const time = (k + draw(seed, voice.id, k, SLOT.jitter)) * STEP;
      // Whole frames, so an excerpt starts a note where a full render does.
      const start = Math.ceil(time * rate);
      if (start >= values.start * rate && start < values.end * rate) frame = start;
    }
    fired.set(k, frame);
    return frame;
  }
  /** @param {number} fromFrame @param {number} toFrame @returns {{ index: number; frame: number }[]} */
  function onsets(fromFrame, toFrame) {
    const found = [];
    for (
      let k = Math.max(0, Math.floor(fromFrame / rate / STEP) - 1);
      k * STEP * rate < toFrame;
      k++
    ) {
      const frame = onset(k);
      if (frame !== undefined && frame >= fromFrame && frame < toFrame)
        found.push({ index: k, frame });
    }
    return found;
  }
  return (from, to) =>
    onsets(from * rate, to * rate).map(({ index: k, frame }) => {
      // The notes sounding are always the latest ones, since every note rings as long, so this
      // one is cut where the eighth note after it starts.
      const pusher = onsets(frame + 1, frame + ring)[MOST_NOTES - 1];
      return pusher
        ? { index: k, frame, end: pusher.frame, cut: true }
        : { index: k, frame, end: frame + ring, cut: false };
    });
}

/**
 * The bell's notes that start from `from` to before `to`, in timeline seconds.
 * @param {Genome} genome a normalized genome
 * @param {Voice} voice one of `genome.voices`
 * @param {number} seed
 * @param {number} rate frames a second
 * @param {number} from
 * @param {number} to
 */
export const bellNotes = (genome, voice, seed, rate, from, to) =>
  noteFinder(genome, voice, seed, rate)(from, to);

/**
 * The partials of a note on `fundamental`, before detuning: in an absolute tuning, the
 * fundamental and up to `partials − 1` members of the scale above it and up to 3 kHz, drawn
 * from the seed; otherwise the fundamental times the ratio table's first `partials` entries,
 * those over 3 kHz left out. Each falls `fall` dB from the one below and rings shorter.
 * @param {Pitch} pitch
 * @param {number} fundamental Hz
 * @param {{ partials: number; fall: number; decay: number; ratios: keyof typeof RATIOS }} settings
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} index the note's candidate slot
 * @returns {Partial[]}
 */
export function bellPartials(pitch, fundamental, settings, seed, voiceId, index) {
  const { partials, fall, decay, ratios } = settings;
  /** @type {number[]} */
  let hz;
  if (isAbsolute(pitch.tuning)) {
    const above = tuningFrequencies(pitch, fundamental, TOP).filter((f) => f > fundamental);
    hz = [fundamental];
    for (let j = 0; j < partials - 1 && above.length > 0; j++) {
      const pick = Math.floor(draw(seed, voiceId, index, SLOT.pick + j) * above.length);
      hz.push(.../** @type {number[]} */ (above.splice(pick, 1)));
    }
    hz.sort((a, b) => a - b);
  } else {
    hz = RATIOS[ratios]
      .slice(0, partials)
      .map((ratio) => fundamental * ratio)
      .filter((f) => f <= TOP);
  }
  return hz.map((f, k) => ({
    hz: f,
    gain: dbToGain(-fall * k),
    t60: decay * UPPER_RING ** (hz.length > 1 ? k / (hz.length - 1) : 0),
    phase: 2 * Math.PI * draw(seed, voiceId, index, SLOT.phase + k),
  }));
}

/**
 * One note's samples and pan, from the seed and the voice's effective values at its start.
 * @param {Pitch} pitch
 * @param {Resolved<BellVoice>} settings
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} index the note's candidate slot
 * @param {number} rate
 */
export function bellNote(pitch, settings, seed, voiceId, index, rate) {
  const { model, decay, partials: count, fall, detune } = settings;
  /** @param {number} slot */
  const u = (slot) => draw(seed, voiceId, index, slot);
  const band = tuningFrequencies(pitch, BAND.lo, BAND.hi);
  const fundamental = band[Math.floor(u(SLOT.pitch) * band.length)];
  if (fundamental === undefined) {
    throw new Error(`bell: the scale has no note from ${BAND.lo} to ${BAND.hi} Hz`);
  }
  const ratio = centsToRatio((u(SLOT.detune) * 2 - 1) * detune);
  const partials = bellPartials(pitch, fundamental, settings, seed, voiceId, index).map((p) => ({
    ...p,
    hz: p.hz * ratio,
  }));
  const frames = ringFrames(decay, rate);
  const lowest = /** @type {Partial} */ (partials[0]);
  let tone;
  if (model === "fm") {
    const modulator = partials[1]?.hz ?? lowest.hz;
    tone = fmTone(
      {
        carrier: lowest.hz,
        modulator,
        index: count * dbToGain(-fall),
        t60: decay,
        indexT60: decay * UPPER_RING,
      },
      frames,
      rate,
    );
  } else if (model === "pluck") {
    // One period of noise, smoothed more the more `fall` darkens the note.
    const smooth = darkness(fall) * 0.9;
    const excitation = new Float64Array(Math.ceil(rate / lowest.hz));
    let last = 0;
    for (let i = 0; i < excitation.length; i++) {
      last = smooth * last + (1 - smooth) * (u(SLOT.noise + i) * 2 - 1);
      excitation[i] = last;
    }
    tone = pluckTone({ hz: lowest.hz, t60: decay, excitation }, frames, rate);
  } else {
    tone = additiveTone(partials, frames, rate);
  }
  const attack = ATTACK.min + darkness(fall) * (ATTACK.max - ATTACK.min);
  const gain = NOTE_PEAK * dbToGain(-VELOCITY_DB * u(SLOT.velocity));
  return {
    samples: shapeNote(tone, { attack, gain, rate }),
    pan: (u(SLOT.pan) * 2 - 1) * PAN_SPREAD,
  };
}

/**
 * Each note is a buffer source and a gain from its start to its end (decision 0010), at the
 * highest density the voice reaches; the cap only shortens notes, so it isn't counted. The
 * notes play through one slot gain each for the most that sound at once, alive through the
 * render.
 * @param {Voice} voice
 * @param {Genome} genome
 */
function cost(voice, genome) {
  const { decay } = /** @type {BellVoice} */ (/** @type {unknown} */ (voice));
  const density = highestValue(genome, voice, "density", PARAMS.density, bell.macros);
  return MOST_NOTES + eventCost({ rate: density / 60, seconds: decay, nodes: 2 });
}

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, genome, voice, seed, from, startFrame, at }) {
  const index = genome.voices.indexOf(voice);
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const rate = ctx.sampleRate;
  const notes = noteFinder(genome, voice, seed, rate);
  /** @param {number} frame a timeline frame */
  const frameTime = (frame) => at(from) + (frame - startFrame) / rate;
  const fade = Math.round(CUT_FADE * rate);
  const connect = eventSlots(ctx, output, MOST_NOTES);

  return (windowFrom, windowTo) => {
    for (const note of notes(windowFrom, windowTo)) {
      if (note.frame < startFrame) continue;
      const self = /** @type {Resolved<BellVoice>} */ (
        /** @type {unknown} */ (effectiveParams(genome, note.frame / rate).voices[index])
      );
      const { samples, pan } = bellNote(pitch, self, seed, voice.id, note.index, rate);
      // Equal-power pan, computed into the buffer's two channels rather than by a panner node.
      const angle = ((pan + 1) * Math.PI) / 4;
      const buffer = ctx.createBuffer(2, samples.length, rate);
      [Math.cos(angle), Math.sin(angle)].forEach((share, channel) => {
        const data = new Float32Array(samples.length);
        for (let n = 0; n < samples.length; n++) data[n] = (samples[n] ?? 0) * share;
        buffer.copyToChannel(data, channel);
      });
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      if (note.cut) {
        // Faded out by the time the note over the cap starts, so eight at most ever sound.
        gain.gain.setValueAtTime(1, frameTime(Math.max(note.frame, note.end - fade)));
        gain.gain.linearRampToValueAtTime(0, frameTime(note.end));
      }
      source.connect(gain);
      connect(gain, note.frame, note.end);
      source.start(frameTime(note.frame));
      source.stop(frameTime(note.end));
    }
  };
}

export const bell = {
  type: "bell",
  description: "struck notes at random",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    { macro: MACRO.density, param: "density", depth: 0.25 },
    { macro: MACRO.brightness, param: "fall", depth: -0.25 },
  ]),
  /** A note rings for its decay. */
  longestEvent: (/** @type {Voice} */ voice) =>
    /** @type {BellVoice} */ (/** @type {unknown} */ (voice)).decay,
  cost,
  build,
};

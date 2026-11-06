// The granular cloud: short Hann-windowed grains read from a tone generated from the seed, each
// at a scale note near the voice's root. Grains are mixed in JS into one stereo buffer per
// event window and played by one AudioBufferSource, because a source, gain and panner per grain
// cost about 560 node-seconds a second at 30 grains a second, the whole budget (decision 0014).
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { eventCost } from "./cost-unit.js";
import { number } from "./descriptor.js";
import { effectiveParams } from "./effective-params.js";
import { highestValue } from "./highest-value.js";
import { MACRO } from "./macro-table.js";
import { resolvePitch, tuningFrequencies } from "./pitch.js";
import { drawer, TRIGGER_SLOT } from "./prng.js";
import { WINDOW } from "./render.js";
import { centsToRatio } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";

const PARAMS = Object.freeze({
  density: number({
    min: 0.5,
    max: 30,
    default: 8,
    unit: "/s",
    scale: "log",
    trajectory: true,
    safe: [2, 20],
    description: "grains a second",
  }),
  size: number({
    min: 0.02,
    max: 0.5,
    default: 0.15,
    unit: "s",
    scale: "log",
    trajectory: true,
    safe: [0.05, 0.3],
    description: "grain length",
  }),
  root: number({
    min: 60,
    max: 1200,
    default: 220,
    unit: "Hz",
    scale: "log",
    trajectory: true,
    safe: [80, 330],
    description: "pitch center",
  }),
  spread: number({
    min: 0,
    max: 2,
    default: 0.5,
    unit: "oct",
    trajectory: true,
    safe: [0, 1],
    description: "pitch ± range",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} GranularVoice */

/** Grain candidates a second: the highest density, so thinning picks each grain (decision 0003). */
export const CANDIDATE_RATE = PARAMS.density.max;

/** A grain's draws; slot 0 is its trigger. */
const SLOT = Object.freeze({ time: 1, pitch: 2, pan: 3, phase: 4, detune: 5, gain: 6 });
/** Draws of the source tone, keyed by harmonic, in slots 7 to 9, which no grain uses. */
const SOURCE_SLOT = 7;

/** Grain pitches snap to scale notes in this band. */
const BAND = Object.freeze({ lo: 30, hi: 3000 });
/** Grains pan within ± this, equal-power. */
const PAN_WIDTH = 0.7;
/** A lone grain's peak. Overlapping grains are scaled by 1 / √overlap to keep the power even. */
const GRAIN_GAIN = 0.5;

/**
 * The source: one second of a tone at `SOURCE_HZ` whose harmonics swell at whole cycles a
 * second, so the buffer loops without a seam, and a grain reading past its end wraps.
 */
const SOURCE_HZ = 220;
const SOURCE_FRAMES = 48000;
const SOURCE_HARMONICS = 6;

/**
 * The seeded source tone for a voice, one sample longer than its period so a read between the
 * last frame and the first interpolates without wrapping. Its peak is 1.
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function grainSource(seed, voiceId, sampleRate) {
  const out = new Float32Array(SOURCE_FRAMES + 1);
  const next = drawer(seed, voiceId);
  const harmonics = Array.from({ length: SOURCE_HARMONICS }, (_, i) => {
    const h = i + 1;
    // Harmonic h falls about 6 dB an octave, with a seeded level, swell rate and phase.
    const u = (/** @type {number} */ slot) => next(h, SOURCE_SLOT + slot);
    return { h, level: (0.25 + 0.75 * u(0)) / h, swells: 1 + Math.floor(3 * u(1)), phase: u(2) };
  });
  let peak = 0;
  for (let i = 0; i < SOURCE_FRAMES; i++) {
    const t = i / SOURCE_FRAMES;
    let value = 0;
    for (const { h, level, swells, phase } of harmonics) {
      const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * (swells * t + phase));
      value += level * swell * Math.sin((2 * Math.PI * h * SOURCE_HZ * i) / sampleRate);
    }
    out[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  for (let i = 0; i < SOURCE_FRAMES; i++) out[i] = /** @type {number} */ (out[i]) / peak;
  out[SOURCE_FRAMES] = /** @type {number} */ (out[0]);
  return out;
}

/**
 * The scale note nearest `hz` in pitch.
 * @param {readonly number[]} notes rising
 * @param {number} hz
 */
function nearestNote(notes, hz) {
  let best = /** @type {number} */ (notes[0]);
  for (const note of notes) {
    if (Math.abs(Math.log(note / hz)) < Math.abs(Math.log(best / hz))) best = note;
  }
  return best;
}

/**
 * @typedef {object} Grain
 * @property {number} index the candidate slot it was drawn on
 * @property {number} frame timeline frame of its first sample
 * @property {number} frames its length
 * @property {number} note the scale note it plays, Hz
 * @property {number} hz the note detuned
 * @property {number} pan -1 to 1
 * @property {number} gain its peak
 * @property {number} phase where in the source it starts, 0 to 1
 */

/**
 * The grains of a granular voice that start in `[from, to)` timeline seconds, in time order.
 * Candidate k starts at a seeded time in `[k, k + 1) / CANDIDATE_RATE` and fires with
 * probability density / CANDIDATE_RATE at that time, so a window holds the same grains in an
 * excerpt as in a full render (decision 0003).
 * @param {{ genome: Genome; voice: Voice; seed: number; from: number; to: number;
 *   sampleRate: number }} where
 * @returns {Grain[]}
 */
export function grainEvents({ genome, voice, seed, from, to, sampleRate }) {
  const index = genome.voices.findIndex((v) => v.id === voice.id);
  if (index === -1) throw new Error(`granular: the genome has no voice "${voice.id}"`);
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const notes = tuningFrequencies(pitch, BAND.lo, BAND.hi);
  if (notes.length === 0) {
    throw new Error(`granular: the scale has no note from ${BAND.lo} to ${BAND.hi} Hz`);
  }
  const begin = Math.max(from, voice.start);
  const end = Math.min(to, voice.end);
  const next = drawer(seed, voice.id);
  /** @type {Grain[]} */
  const grains = [];
  for (let k = Math.floor(begin * CANDIDATE_RATE); k < end * CANDIDATE_RATE; k++) {
    /** @param {number} slot */
    const u = (slot) => next(k, slot);
    const time = (k + u(SLOT.time)) / CANDIDATE_RATE;
    if (time < begin || time >= end) continue;
    const self = /** @type {Resolved<GranularVoice>} */ (
      /** @type {unknown} */ (effectiveParams(genome, time).voices[index])
    );
    // Thinning (decision 0003), as `fires` with the drawer.
    if (u(TRIGGER_SLOT) >= self.density / CANDIDATE_RATE) continue;
    const note = nearestNote(notes, self.root * 2 ** (self.spread * (2 * u(SLOT.pitch) - 1)));
    const overlap = Math.max(1, self.density * self.size);
    grains.push({
      index: k,
      frame: Math.ceil(time * sampleRate),
      frames: Math.round(self.size * sampleRate),
      note,
      hz: note * centsToRatio(self.detune * (2 * u(SLOT.detune) - 1)),
      pan: PAN_WIDTH * (2 * u(SLOT.pan) - 1),
      gain: (GRAIN_GAIN * (0.5 + 0.5 * u(SLOT.gain))) / Math.sqrt(overlap),
      phase: u(SLOT.phase),
    });
  }
  return grains;
}

/** A Hann window as a table, read with linear interpolation: cheaper than a cosine a sample. */
const HANN_POINTS = 4096;
// One zero past the end, so a read at the last point interpolates toward nothing.
const HANN = Float64Array.from({ length: HANN_POINTS + 2 }, (_, i) =>
  i > HANN_POINTS ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / HANN_POINTS),
);

/**
 * Mixes `grains` into a stereo buffer that starts at timeline frame `first` and runs to the end
 * of the last grain. Each grain rises from 0 and falls back to 0 under its window, so neither
 * edge steps.
 * @param {readonly Grain[]} grains each starting at or after `first`
 * @param {Float32Array} source from `grainSource`
 * @param {number} first
 * @param {number} sampleRate
 * @returns {Float32Array<ArrayBuffer>[]} left and right
 */
export function mixGrains(grains, source, first, sampleRate) {
  const length = Math.max(0, ...grains.map((g) => g.frame + g.frames - first));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const period = source.length - 1;
  for (const grain of grains) {
    const angle = ((grain.pan + 1) * Math.PI) / 4;
    const toLeft = grain.gain * Math.cos(angle);
    const toRight = grain.gain * Math.sin(angle);
    const step = (grain.hz / SOURCE_HZ) * (SOURCE_FRAMES / sampleRate);
    let read = grain.phase * period;
    for (let i = 0; i < grain.frames; i++) {
      // Exactly HANN_POINTS at the last frame, where the window is 0 again.
      const at = (i * HANN_POINTS) / (grain.frames - 1);
      const w0 = Math.floor(at);
      const hann = interpolate(HANN, w0, at - w0);
      const r0 = Math.floor(read);
      const value = hann * interpolate(source, r0, read - r0);
      const out = grain.frame - first + i;
      left[out] = /** @type {number} */ (left[out]) + toLeft * value;
      right[out] = /** @type {number} */ (right[out]) + toRight * value;
      read += step;
      if (read >= period) read -= period;
    }
  }
  return [left, right];
}

/**
 * @param {ArrayLike<number>} table
 * @param {number} i
 * @param {number} fraction
 */
function interpolate(table, i, fraction) {
  const a = /** @type {number} */ (table[i]);
  const b = /** @type {number} */ (table[i + 1]);
  return a + fraction * (b - a);
}

/**
 * Mixing grains in JS costs render time the node count doesn't show. Measured on mbp2021, a
 * grain-second (one grain sounding one second) takes 0.36 ms to compute, as long as about 3
 * node-seconds at the fastest rate 0010 measured, 1.24e-4 s each (decision 0014).
 */
const MIX_WEIGHT = 3;

const MACROS = /** @type {MacroRow[]} */ ([
  { macro: MACRO.density, param: "density", depth: 0.25 },
  { macro: MACRO.brightness, param: "root", depth: 0.15 },
  { macro: MACRO.motion, param: "spread", depth: 0.25 },
]);

/**
 * One buffer source a window, sounding the window and its longest grain past it, plus the JS
 * mixing at the highest density and size the voice's trajectories and macros reach.
 * @param {Voice} voice
 * @param {Genome} genome
 */
function cost(voice, genome) {
  const cloud = /** @type {GranularVoice} */ (/** @type {unknown} */ (voice));
  const highest = (/** @type {"density" | "size"} */ param) =>
    highestValue(genome, cloud, param, PARAMS[param], MACROS);
  const size = highest("size");
  return (
    eventCost({ rate: 1 / WINDOW, seconds: WINDOW + size, nodes: 1 }) +
    MIX_WEIGHT * highest("density") * size
  );
}

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, genome, voice, seed, from, startFrame, at }) {
  const rate = ctx.sampleRate;
  const source = grainSource(seed, voice.id, rate);
  return (windowFrom, windowTo) => {
    const grains = grainEvents({
      genome,
      voice,
      seed,
      from: windowFrom,
      to: windowTo,
      sampleRate: rate,
    });
    if (grains.length === 0) return;
    const first = Math.round(windowFrom * rate);
    const channels = mixGrains(grains, source, first, rate);
    const buffer = ctx.createBuffer(2, /** @type {Float32Array} */ (channels[0]).length, rate);
    for (const [c, data] of channels.entries()) buffer.copyToChannel(data, c);
    const player = ctx.createBufferSource();
    player.buffer = buffer;
    player.connect(output);
    // Started on a whole frame, so the buffer's samples land on the timeline frames they were
    // mixed for in every render.
    player.start(at(from) + (first - startFrame) / rate);
  };
}

export const granularCloud = {
  type: "granular",
  description: "Hann grains of a seeded tone, on scale notes",
  params: PARAMS,
  macros: MACROS,
  /** A grain sounds at most its longest size past its start. */
  longestEvent: () => PARAMS.size.max,
  cost,
  build,
};

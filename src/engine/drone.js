// The drone voice: a stack of sine partials on one low fundamental, in three detuned copies
// spread across the stereo field, through a slowly swept low-pass. Oscillators are the main
// render cost (decision 0002, probe d), so each copy plays its harmonic partials from one
// PeriodicWave rather than one oscillator per partial.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Pitch } from "./pitch.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { SWEPT_FILTER_WEIGHT } from "./cost-unit.js";
import { dbToGain } from "./decibels.js";
import { int, number } from "./descriptor.js";
import { MACRO } from "./macro-table.js";
import { phasedOscillator } from "./phased-wave.js";
import { resolvePitch, tuningFrequencies } from "./pitch.js";
import { centsToRatio, isAbsolute } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";

const PARAMS = Object.freeze({
  root: number({
    min: 33,
    max: 135,
    default: 55,
    unit: "Hz",
    scale: "log",
    safe: [36, 75],
    description: "nearest scale note",
  }),
  partials: int({ min: 4, max: 12, default: 8, unit: "", safe: [4, 8], description: "sines" }),
  slope: number({
    min: 4,
    max: 8,
    default: 6,
    unit: "dB",
    safe: [6, 8],
    description: "per partial octave",
  }),
  cutoff: number({
    min: 100,
    max: 2000,
    default: 600,
    unit: "Hz",
    scale: "log",
    trajectory: true,
    safe: [100, 800],
    description: "low-pass",
  }),
  sweep: number({
    min: 0,
    max: 2,
    default: 1,
    unit: "oct",
    trajectory: true,
    safe: [0, 1.5],
    description: "± swing",
  }),
  period: number({
    min: 30,
    max: 300,
    default: 90,
    unit: "s",
    scale: "log",
    description: "swing cycle",
  }),
  q: number({ min: 0.5, max: 4, default: 0.7, unit: "", safe: [0.5, 2], description: "filter Q" }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} DroneVoice */

/**
 * The copies of the stack: each is detuned by `spread` times the voice's `detune` cents and
 * panned to `pan`, so the copies beat against each other and fill the stereo field.
 */
const COPIES = Object.freeze([
  { spread: -1, pan: -0.5 },
  { spread: 0, pan: 0 },
  { spread: 1, pan: 0.5 },
]);

/** In an absolute tuning, a partial within this many cents of a scale member plays the member. */
const SNAP_CENTS = 40;

/**
 * @param {readonly number[]} candidates
 * @param {number} hz
 * @returns {number | undefined} the candidate nearest `hz` in pitch
 */
function nearest(candidates, hz) {
  /** @param {number} f */
  const distance = (f) => Math.abs(Math.log(f / hz));
  return candidates.reduce(
    (best, f) => (best === undefined || distance(f) < distance(best) ? f : best),
    /** @type {number | undefined} */ (undefined),
  );
}

/**
 * The scale note nearest `root` within the drone's register, 33 to 135 Hz.
 * @param {Pitch} pitch
 * @param {number} root Hz
 */
export function droneFundamental(pitch, root) {
  const { min, max } = PARAMS.root;
  const found = nearest(tuningFrequencies(pitch, min, max), root);
  if (found === undefined) {
    throw new Error(`drone: the scale has no note from ${min} to ${max} Hz`);
  }
  return found;
}

/**
 * The partials of the stack, falling `slope` dB for each doubling of the partial number. A
 * partial is the harmonic `harmonic` of the fundamental, except that in an absolute tuning one
 * within 40 cents of a scale member plays that member instead and has no `harmonic`.
 * @param {Pitch} pitch
 * @param {number} fundamental Hz
 * @param {number} count
 * @param {number} slope dB per partial octave
 * @returns {{ hz: number; gain: number; harmonic?: number }[]}
 */
export function dronePartials(pitch, fundamental, count, slope) {
  const snap = centsToRatio(SNAP_CENTS);
  return Array.from({ length: count }, (_, i) => {
    const harmonic = i + 1;
    const target = harmonic * fundamental;
    const gain = dbToGain(-slope * Math.log2(harmonic));
    if (isAbsolute(pitch.tuning)) {
      const member = nearest(tuningFrequencies(pitch, target / snap, target * snap), target);
      if (member !== undefined && member !== target) return { hz: member, gain };
    }
    return { hz: target, gain, harmonic };
  });
}

/**
 * The cutoff swung `sweep` octaves either side of `cutoff` by a sine of the timeline time, so
 * the sweep's phase is the same in an excerpt as in a full render, held to the cutoff's range.
 * @param {number} cutoff
 * @param {number} sweep
 * @param {number} period
 * @param {number} time
 */
function sweptCutoff(cutoff, sweep, period, time) {
  const { min, max } = PARAMS.cutoff;
  const swung = cutoff * 2 ** (sweep * Math.sin((2 * Math.PI * time) / period));
  return Math.min(max, Math.max(min, swung));
}

/**
 * The fundamental and partials a drone voice plays in the genome's tuning.
 * @param {Genome} genome
 * @param {DroneVoice} drone
 */
function stack(genome, drone) {
  const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
  const fundamental = droneFundamental(pitch, drone.root);
  return { fundamental, partials: dronePartials(pitch, fundamental, drone.partials, drone.slope) };
}

/**
 * The swept filter, a panner per copy, and in each copy the oscillator of the harmonic
 * partials plus one per snapped partial, all alive while the voice plays (decision 0010).
 * @param {Voice} voice
 * @param {Genome} genome
 */
function cost(voice, genome) {
  const { partials } = stack(genome, /** @type {DroneVoice} */ (/** @type {unknown} */ (voice)));
  const snapped = partials.filter((p) => p.harmonic === undefined).length;
  return SWEPT_FILTER_WEIGHT + COPIES.length * (2 + snapped);
}

/**
 * @param {VoiceSetup} setup
 * @returns {VoiceWindow}
 */
function build({ ctx, output, genome, voice, from, to, startFrame, at, automate }) {
  const drone = /** @type {DroneVoice} */ (/** @type {unknown} */ (voice));
  const { fundamental, partials } = stack(genome, drone);
  // The copies' stacks sum to at most 1 before the voice's level.
  const total = partials.reduce((sum, p) => sum + p.gain, 0) * COPIES.length;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  // Web Audio reads a low-pass Q in dB; the genome's q is the usual linear Q.
  filter.Q.value = 20 * Math.log10(drone.q);
  automate(filter.frequency, (self, time) =>
    sweptCutoff(
      /** @type {number} */ (self.cutoff),
      /** @type {number} */ (self.sweep),
      drone.period,
      time,
    ),
  );
  filter.connect(output);
  if (drone.start >= to || drone.end <= from) return undefined;

  // One wave of the harmonic partials at the fundamental, and one single-sine wave per snapped
  // partial, which isn't a harmonic of anything the first wave plays.
  const harmonics = new Float32Array(Math.max(...partials.map((p) => p.harmonic ?? 0)) + 1);
  for (const p of partials) if (p.harmonic !== undefined) harmonics[p.harmonic] = p.gain / total;
  const waves = [
    { hz: fundamental, gains: harmonics },
    ...partials
      .filter((p) => p.harmonic === undefined)
      .map((p) => ({ hz: p.hz, gains: new Float32Array([0, p.gain / total]) })),
  ];
  // Oscillators start on whole frames: the voice's first frame, or in an excerpt the render's
  // first frame, with the phase the voice has reached by then (decision 0007).
  const rate = ctx.sampleRate;
  const firstFrame = Math.ceil(drone.start * rate);
  const beginFrame = Math.max(firstFrame, startFrame);
  const begin = at(from) + (beginFrame - startFrame) / rate;
  const elapsed = (beginFrame - firstFrame) / rate;
  for (const { spread, pan } of COPIES) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(filter);
    const ratio = centsToRatio(spread * drone.detune);
    for (const { hz, gains } of waves) {
      const oscillator = phasedOscillator(ctx, gains, hz * ratio, elapsed);
      oscillator.connect(panner);
      oscillator.start(begin);
      oscillator.stop(at(drone.end));
    }
  }
  return undefined;
}

export const drone = {
  type: "drone",
  description: "sine stack ×3 detuned, swept low-pass",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    { macro: MACRO.brightness, param: "cutoff", depth: 0.25 },
    { macro: MACRO.motion, param: "sweep", depth: 0.25 },
  ]),
  /** Its oscillators sound from start to end, their phase from timeline time. */
  longestEvent: () => 0,
  cost,
  build,
};

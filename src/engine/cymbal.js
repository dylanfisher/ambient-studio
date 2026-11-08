// The cymbal: sparse bright hits, struck on a grid from timeline 0 as the bell is (decisions
// 0013, 0071). Each hit is seeded noise through six inharmonic resonances around `center` and a
// brighter wash that dies sooner, ringing `decay` seconds, each resonance's level fluttering at
// its own slow rate by `shimmer`. At most six hits sound at once.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { number } from "./descriptor.js";
import { MACRO } from "./macro-table.js";
import { drawer } from "./prng.js";
import { buildStrikes, ringFrames, shapeHit, strikeCost, strikeFinder } from "./struck.js";
import { DENSITY_ROW, JITTER_SLOT, strikeDensity } from "./struck-params.js";
import { centsToRatio } from "./tuning.js";

const PARAMS = Object.freeze({
  density: strikeDensity({ max: 20, default: 4, safe: [0.5, 8] }),
  decay: number({
    min: 1,
    max: 12,
    default: 6,
    unit: "s",
    scale: "log",
    safe: [3, 10],
    description: "T60",
  }),
  center: number({
    min: 3500,
    max: 11000,
    default: 6000,
    unit: "Hz",
    scale: "log",
    trajectory: true,
    safe: [4500, 8000],
    description: "resonances",
  }),
  shimmer: number({
    min: 0,
    max: 1,
    default: 0.4,
    unit: "",
    trajectory: true,
    description: "flutter",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} CymbalVoice */

/**
 * Candidates every 2 s, each starting up to half a step late, so two hits are at least 1 s
 * apart; at most six hits sound at once.
 */
const GRID = Object.freeze({ step: 2, jitter: 0.5, most: 6 });

/**
 * The resonances' frequencies as ratios of `center`, none harmonic to another; each is moved by a
 * drawn amount up to ±3% a hit. At the lowest center the lowest sits at 2.1 kHz.
 */
const RATIOS = Object.freeze([0.6, 0.74, 0.93, 1.17, 1.41, 1.72]);
/** The drawn spread of each ratio, either side. */
const RATIO_SPREAD = 0.03;
/** Each resonance's center over its bandwidth. */
const Q = 10;
/** The wash, white noise differenced so it rises 6 dB an octave, against one resonance. */
const WASH = 0.3;
/** The wash rings this share of the decay. */
const WASH_RING = 0.25;
/** Each resonance's level flutters at a drawn rate in this range, Hz. */
const FLUTTER = Object.freeze({ lo: 1, hi: 5 });
/** A hit: its attack, its loudest peak, its velocities and its pans. */
const SHAPE = Object.freeze({ attack: 0.002, peak: 0.5, velocityDb: 6, panSpread: 0.5 });

/**
 * Per-hit draws (decision 0003), each list a slot per resonance; `noise` takes one per frame.
 */
const SLOT = Object.freeze({
  velocity: JITTER_SLOT + 1,
  pan: JITTER_SLOT + 2,
  detune: JITTER_SLOT + 3,
  ratio: JITTER_SLOT + 4,
  rate: JITTER_SLOT + 4 + RATIOS.length,
  phase: JITTER_SLOT + 4 + 2 * RATIOS.length,
  noise: JITTER_SLOT + 4 + 3 * RATIOS.length,
});

/**
 * The cymbal's hits that start from `from` to before `to`, in timeline seconds.
 * @param {Genome} genome a normalized genome
 * @param {Voice} voice one of `genome.voices`
 * @param {number} seed
 * @param {number} rate frames a second
 * @param {number} from
 * @param {number} to
 */
export const cymbalHits = (genome, voice, seed, rate, from, to) =>
  strikeFinder(genome, voice, seed, rate, GRID)(from, to);

/**
 * One hit, computed from the seed and the effective values at its start. Each
 * resonance is a two-pole band-pass on the hit's noise, z[n] = (1 − r)(x[n] − x[n−2]) +
 * 2r cos(ω) z[n−1] − r² z[n−2], its level swept between 1 and 1 − `shimmer` by a cosine at its
 * drawn rate, computed by the same kind of recurrence.
 * @param {Resolved<CymbalVoice>} settings
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} index the hit's candidate slot
 * @param {number} rate
 */
export function cymbalHit(settings, seed, voiceId, index, rate) {
  const { decay, center, shimmer, detune } = settings;
  const draws = drawer(seed, voiceId);
  /** @param {number} slot */
  const u = (slot) => draws(index, slot);
  const frames = ringFrames(decay, rate);
  const ratio = centsToRatio((u(SLOT.detune) * 2 - 1) * detune);
  const modes = RATIOS.map((r, j) => {
    const hz = center * ratio * r * (1 + RATIO_SPREAD * (u(SLOT.ratio + j) * 2 - 1));
    const radius = Math.exp((-Math.PI * hz) / Q / rate);
    const flutter = FLUTTER.lo + (FLUTTER.hi - FLUTTER.lo) * u(SLOT.rate + j);
    const step = (2 * Math.PI * flutter) / rate;
    const phase = 2 * Math.PI * u(SLOT.phase + j);
    return {
      gain: 1 - radius,
      a: 2 * radius * Math.cos((2 * Math.PI * hz) / rate),
      b: radius * radius,
      z1: 0,
      z2: 0,
      twoCos: 2 * Math.cos(step),
      // The flutter's cosine at frames 0 and −1.
      c1: Math.cos(phase),
      c2: Math.cos(phase - step),
    };
  });
  const fall = 10 ** (-3 / (decay * rate));
  const washFall = 10 ** (-3 / (WASH_RING * decay * rate));
  const half = shimmer / 2;
  const tone = new Float64Array(frames);
  let envelope = 1;
  let wash = WASH;
  let x1 = 0;
  let x2 = 0;
  for (let n = 0; n < frames; n++) {
    const x = u(SLOT.noise + n) * 2 - 1;
    let sum = wash * (x - x1);
    for (const mode of modes) {
      const z = mode.gain * (x - x2) + mode.a * mode.z1 - mode.b * mode.z2;
      mode.z2 = mode.z1;
      mode.z1 = z;
      sum += z * (1 - half + half * mode.c1);
      const c = mode.twoCos * mode.c1 - mode.c2;
      mode.c2 = mode.c1;
      mode.c1 = c;
    }
    tone[n] = sum * envelope;
    envelope *= fall;
    wash *= washFall;
    x2 = x1;
    x1 = x;
  }
  return shapeHit(tone, SHAPE, { velocity: u(SLOT.velocity), pan: u(SLOT.pan) }, rate);
}

/**
 * Computing a hit in JS costs render time the node count doesn't show: timed alone on mbp2021, a
 * second of ring takes 1.6 ms, 13 node-seconds at 1.24e-4 s each; 15 bounds what the densest
 * cymbal measured in a render (decision 0071).
 */
const RING_WEIGHT = 15;

export const cymbal = {
  type: "cymbal",
  description: "sparse bright accents: struck metal, long ring",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    DENSITY_ROW,
    { macro: MACRO.brightness, param: "center", depth: 0.25 },
    { macro: MACRO.motion, param: "shimmer", depth: 0.25 },
  ]),
  /** A hit rings for its decay. */
  longestEvent: (/** @type {Voice} */ voice) =>
    /** @type {CymbalVoice} */ (/** @type {unknown} */ (voice)).decay,
  /**
   * Six slot gains, a buffer source and a gain a hit, and the JS that computes its ring.
   * @param {Voice} voice
   * @param {Genome} genome
   */
  cost: (voice, genome) =>
    strikeCost(voice, genome, cymbal, { most: GRID.most, weight: RING_WEIGHT }),
  /**
   * @param {VoiceSetup} setup
   * @returns {VoiceWindow}
   */
  build: (setup) =>
    buildStrikes(setup, GRID, (/** @type {Resolved<CymbalVoice>} */ self, index) =>
      cymbalHit(self, setup.seed, setup.voice.id, index, setup.ctx.sampleRate),
    ),
};

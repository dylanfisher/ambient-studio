// The drum: sparse low hits, struck on a grid from timeline 0 as the bell is (decisions 0013,
// 0071). Each hit is a membrane's two lowest modes, their pitch starting `drop` octaves above the
// scale note nearest `root` and falling to it within about 0.1 s, under a short noise strike,
// ringing `decay` seconds. At most three hits sound at once.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Resolved } from "./effective-params.js" */
/** @import { Genome, Voice, VOICE_PARAMS } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Pitch } from "./pitch.js" */
/** @import { VoiceSetup, VoiceWindow } from "./render.js" */
import { dbToGain } from "./decibels.js";
import { number } from "./descriptor.js";
import { drone, droneFundamental } from "./drone.js";
import { MACRO } from "./macro-table.js";
import { resolvePitch } from "./pitch.js";
import { drawer } from "./prng.js";
import { buildStrikes, ringFrames, shapeHit, strikeCost, strikeFinder } from "./struck.js";
import { DENSITY_ROW, JITTER_SLOT, strikeDensity } from "./struck-params.js";
import { centsToRatio } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";

const PARAMS = Object.freeze({
  density: strikeDensity({ max: 40, default: 4, safe: [0.5, 12] }),
  decay: number({
    min: 0.1,
    max: 1.5,
    default: 0.6,
    unit: "s",
    scale: "log",
    safe: [0.3, 1.2],
    description: "T60",
  }),
  // Snapped to the nearest scale note as the drone root is, so it keeps the drone register.
  root: number({
    min: drone.params.root.min,
    max: drone.params.root.max,
    default: 55,
    unit: "Hz",
    scale: "log",
    safe: [40, 80],
    description: drone.params.root.description,
  }),
  drop: number({
    min: 0,
    max: 2,
    default: 1,
    unit: "oct",
    trajectory: true,
    description: "strike pitch fall",
  }),
});

/** @typedef {ValuesOf<typeof VOICE_PARAMS> & ValuesOf<typeof PARAMS>} DrumVoice */

/**
 * Candidates every 0.5 s, each starting up to half a step late, so two hits are at least 0.25 s
 * apart; at most three hits sound at once.
 */
const GRID = Object.freeze({ step: 0.5, jitter: 0.5, most: 3 });

/** Seconds the pitch takes to fall by a factor of e toward the root. */
const FALL = 0.025;
/**
 * The membrane's second mode, as a ratio of the first (an ideal circular membrane's), its level
 * and its ring as a share of the decay.
 */
const UPPER = Object.freeze({ ratio: 1.594, db: -10, ring: 0.5 });
/** The strike: noise through a one-pole low-pass at this many Hz, its level and its ring in s. */
const STRIKE = Object.freeze({ hz: 400, db: -14, ring: 0.03 });
/** A hit: its attack, its loudest peak, its velocities and its pans. */
const SHAPE = Object.freeze({ attack: 0.001, peak: 0.5, velocityDb: 9, panSpread: 0.3 });

/** Per-hit draws (decision 0003); `noise` takes one per frame of the strike. */
const SLOT = Object.freeze({
  velocity: JITTER_SLOT + 1,
  pan: JITTER_SLOT + 2,
  detune: JITTER_SLOT + 3,
  noise: JITTER_SLOT + 4,
});

/**
 * The drum's hits that start from `from` to before `to`, in timeline seconds.
 * @param {Genome} genome a normalized genome
 * @param {Voice} voice one of `genome.voices`
 * @param {number} seed
 * @param {number} rate frames a second
 * @param {number} from
 * @param {number} to
 */
export const drumHits = (genome, voice, seed, rate, from, to) =>
  strikeFinder(genome, voice, seed, rate, GRID)(from, to);

/**
 * One hit, computed from the seed and the effective values at its start. A mode
 * at `hz` that starts `2^drop` times higher has the frequency hz (1 + (2^drop − 1) e^(−t/FALL)),
 * whose phase is 2π hz (t + (2^drop − 1) FALL (1 − e^(−t/FALL))).
 * @param {Pitch} pitch
 * @param {Resolved<DrumVoice>} settings
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} index the hit's candidate slot
 * @param {number} rate
 */
export function drumHit(pitch, settings, seed, voiceId, index, rate) {
  const { decay, root, drop, detune } = settings;
  const draws = drawer(seed, voiceId);
  /** @param {number} slot */
  const u = (slot) => draws(index, slot);
  const frames = ringFrames(decay, rate);
  const hz = droneFundamental(pitch, root) * centsToRatio((u(SLOT.detune) * 2 - 1) * detune);
  const sweep = (2 ** drop - 1) * FALL;
  const fall = 10 ** (-3 / (decay * rate));
  const upperFall = 10 ** (-3 / (UPPER.ring * decay * rate));
  const strikeFall = 10 ** (-3 / (STRIKE.ring * rate));
  const smooth = Math.exp((-2 * Math.PI * STRIKE.hz) / rate);
  const strikeFrames = Math.min(frames, Math.ceil(STRIKE.ring * rate));
  const tone = new Float64Array(frames);
  let body = 1;
  let upper = dbToGain(UPPER.db);
  let strike = dbToGain(STRIKE.db);
  let noise = 0;
  for (let n = 0; n < frames; n++) {
    const t = n / rate;
    const turns = hz * (t + sweep * (1 - Math.exp(-t / FALL)));
    let value =
      body * Math.sin(2 * Math.PI * turns) + upper * Math.sin(2 * Math.PI * UPPER.ratio * turns);
    if (n < strikeFrames) {
      noise = smooth * noise + (1 - smooth) * (u(SLOT.noise + n) * 2 - 1);
      value += strike * noise;
      strike *= strikeFall;
    }
    tone[n] = value;
    body *= fall;
    upper *= upperFall;
  }
  return shapeHit(tone, SHAPE, { velocity: u(SLOT.velocity), pan: u(SLOT.pan) }, rate);
}

/**
 * Computing a hit in JS costs render time the node count doesn't show: timed alone on mbp2021, a
 * second of ring takes 2.4 ms, 19 node-seconds at 1.24e-4 s each; 24 bounds what the densest
 * drum measured in a render (decision 0071).
 */
const RING_WEIGHT = 24;

export const drum = {
  type: "drum",
  description: "sparse low accents: struck membrane, falling pitch",
  params: PARAMS,
  macros: /** @type {MacroRow[]} */ ([
    DENSITY_ROW,
    { macro: MACRO.brightness, param: "drop", depth: 0.25 },
  ]),
  /** A hit rings for its decay. */
  longestEvent: (/** @type {Voice} */ voice) =>
    /** @type {DrumVoice} */ (/** @type {unknown} */ (voice)).decay,
  /**
   * Three slot gains, a buffer source and a gain a hit, and the JS that computes its ring.
   * @param {Voice} voice
   * @param {Genome} genome
   */
  cost: (voice, genome) =>
    strikeCost(voice, genome, drum, { most: GRID.most, weight: RING_WEIGHT }),
  /**
   * @param {VoiceSetup} setup
   * @returns {VoiceWindow}
   */
  build: (setup) => {
    const { genome } = setup;
    const pitch = resolvePitch(getTuning(genome.tuning), genome.scale, genome.key);
    return buildStrikes(setup, GRID, (/** @type {Resolved<DrumVoice>} */ self, index) =>
      drumHit(pitch, self, setup.seed, setup.voice.id, index, setup.ctx.sampleRate),
    );
  },
};

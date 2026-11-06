// Random valid genomes from a seed, for property tests and as phase 2's stand-in for the LLM.
// Every draw goes through the counter-based PRNG under voice id "" (decision 0003).
/** @import { Descriptor, DescriptorTable, NumberDescriptor } from "./descriptor.js" */
/** @import { Genome } from "./genome-schema.js" */
/** @import { Curve, Trajectory } from "./trajectory.js" */
import { COST_BUDGET, cost } from "./cost.js";
import { allowsTrajectory, choices, decode, encode, isNumeric } from "./descriptor.js";
import { GLOBAL_PARAMS, MACROS } from "./genome-schema.js";
import { draw, GENOME_SLOT } from "./prng.js";
import { CURVES } from "./trajectory.js";
import { isAbsolute } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";
import { requireGenome } from "./validate-genome.js";
import { voiceParams, voiceTypeIds } from "./voice-registry.js";

const MOST_VOICES = 4;
/** Draws `randomGenome` makes before it gives up on meeting a cost cap. */
const ATTEMPTS = 100;
const TRAJECTORY_CHANCE = 1 / 3;
/** Latest time of a trajectory's first point, in seconds. */
const FIRST_POINT_LATEST = 60;
/** Gaps between breakpoints, in whole seconds; never under the 10 s a sweep needs to be heard. */
const GAP_MIN = 20;
const GAP_MAX = 120;
/** Each fade is at most this share of the duration, leaving at least half for excerpts. */
const FADE_SHARE = 1 / 4;

const curves = /** @type {Curve[]} */ (Object.keys(CURVES));

/** @typedef {() => number} Source the next draw, in [0, 1) */

/**
 * @template T
 * @param {Source} next
 * @param {readonly T[]} items
 */
const pick = (next, items) => /** @type {T} */ (items[Math.floor(next() * items.length)]);

/**
 * A value in the descriptor's safe range, uniform along its scale.
 * @param {Source} next
 * @param {NumberDescriptor} descriptor
 */
function numberIn(next, descriptor) {
  const [lo, hi] = descriptor.safe ?? [descriptor.min, descriptor.max];
  const a = encode(descriptor, lo);
  return decode(descriptor, a + next() * (encode(descriptor, hi) - a));
}

/** @param {Source} next */
const gap = (next) => GAP_MIN + Math.floor(next() * (GAP_MAX - GAP_MIN + 1));

/**
 * @param {Source} next
 * @param {NumberDescriptor} descriptor
 * @param {number} duration
 * @returns {Trajectory}
 */
function trajectory(next, descriptor, duration) {
  const start = Math.floor(next() * FIRST_POINT_LATEST);
  /** @type {Trajectory} */
  const result = { points: [[start, numberIn(next, descriptor)]] };
  for (let time = start + gap(next); time <= duration; time += gap(next)) {
    result.points.push([time, numberIn(next, descriptor), pick(next, curves)]);
  }
  return result;
}

/**
 * @param {Source} next
 * @param {Descriptor} descriptor
 * @param {number} duration
 */
function valueFor(next, descriptor, duration) {
  if (isNumeric(descriptor)) {
    const drawn = allowsTrajectory(descriptor) && next() < TRAJECTORY_CHANCE;
    return drawn ? trajectory(next, descriptor, duration) : numberIn(next, descriptor);
  }
  return pick(next, choices(descriptor));
}

/**
 * Draws each parameter of `table` that `values` doesn't hold yet. Parameters with `when` read
 * the others, so they go second, and are skipped where they don't apply.
 * @param {Source} next
 * @param {DescriptorTable} table
 * @param {Record<string, unknown>} values
 * @param {number} duration
 */
function fill(next, table, values, duration) {
  const entries = Object.entries(table);
  for (const [name, descriptor] of [
    ...entries.filter(([, d]) => !d.when),
    ...entries.filter(([, d]) => d.when),
  ]) {
    if (Object.hasOwn(values, name) || descriptor.when?.applies(values) === false) continue;
    values[name] = valueFor(next, descriptor, duration);
  }
  return values;
}

/**
 * One genome drawn from `next`.
 * @param {Source} next
 * @param {string[]} types
 * @param {number} seed for the error message
 * @returns {Genome}
 */
function drawGenome(next, types, seed) {
  const duration = Math.round(numberIn(next, GLOBAL_PARAMS.duration));
  const tuningId = pick(next, GLOBAL_PARAMS.tuning.values);
  const tuning = getTuning(tuningId);
  /** @type {Record<string, unknown>} */
  const pitch = { tuning: tuningId, scale: pick(next, Object.keys(tuning.scales)) };
  if (!isAbsolute(tuning)) pitch.key = Math.floor(next() * tuning.degrees.length);
  const fadeIn = next() * Math.min(GLOBAL_PARAMS.fadeIn.max, duration * FADE_SHARE);
  const fadeOut = next() * Math.min(GLOBAL_PARAMS.fadeOut.max, duration * FADE_SHARE);
  const globals = fill(next, GLOBAL_PARAMS, { duration, ...pitch, fadeIn, fadeOut }, duration);
  const macros = fill(next, MACROS, {}, duration);

  const voices = Array.from({ length: 1 + Math.floor(next() * MOST_VOICES) }, (_, i) => {
    const type = pick(next, types);
    const start = Math.floor((next() * duration) / 3);
    // Ends in the last third of what's left, so every voice plays at least two thirds of it.
    const end = start + Math.ceil(((duration - start) * (2 + next())) / 3);
    return fill(next, voiceParams(type), { id: `v${i + 1}`, type, start, end }, duration);
  });

  return requireGenome(
    { ...globals, macros, voices },
    `randomGenome(${seed}) drew an invalid genome`,
  );
}

/**
 * A valid, normalized genome drawn from the seed: one to four voices of the registered types,
 * parameters from the ranges their descriptors mark as safe, and about a third of the
 * parameters that may be trajectories drawn as one, with breakpoints 20–120 s apart. A draw
 * that costs more than `costCap` is dropped and the next one drawn from the same sequence, so
 * a capped genome is still fixed by its seed; after 100 draws over the cap it throws.
 * @param {number} seed an integer in [0, 2^32 − 1]
 * @param {{ costCap?: number }} [options] the most `cost()` may return: `COST_BUDGET` by
 *   default, `Infinity` for no cap
 * @returns {Genome}
 */
export function randomGenome(seed, { costCap = COST_BUDGET } = {}) {
  const types = voiceTypeIds();
  if (types.length === 0) throw new Error("randomGenome: no voice type is registered");
  let counter = 0;
  /** @type {Source} */
  const next = () => draw(seed, "", counter++, GENOME_SLOT.randomGenome);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const genome = drawGenome(next, types, seed);
    if (cost(genome) <= costCap) return genome;
  }
  throw new Error(
    `randomGenome(${seed}): none of ${ATTEMPTS} draws came under the cost cap of ${costCap}`,
  );
}

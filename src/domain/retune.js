// Retunes (decision 0094): a base genome with its tuning, scale and key set to the owner's
// choice and nothing else changed, taken through the chain every proposal runs (0053), so the
// locks and the brief hold as for a nudge. No model request and no seed: the same base and pitch
// always give the same genome.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { Proposal } from "./propose-genome.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { canonicalGenome } from "../engine/canonical-genome.js";
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";
import { frequency, resolvePitch } from "../engine/pitch.js";
import { isAbsolute } from "../engine/tuning.js";
import { getTuning } from "../engine/tuning-registry.js";
import { paramName } from "./param-name.js";
import { proposeWritten } from "./propose-genome.js";

/** @param {Descriptor} descriptor */
const globalName = (descriptor) => paramName(GLOBAL_PARAMS, descriptor);

/** The global parameters a retune sets, as its request names them; a lock on any refuses it. */
export const RETUNE_FIELD = Object.freeze({
  tuning: globalName(GLOBAL_PARAMS.tuning),
  scale: globalName(GLOBAL_PARAMS.scale),
  key: globalName(GLOBAL_PARAMS.key),
});

const RETUNE_PATHS = Object.values(RETUNE_FIELD);

/** The scale every tuning has (decision 0004), which a retune falls back to. */
const ALL = "all";

/** How many periods either side of the reference's the nearest key looks in. */
const PERIODS_AROUND = 6;

/**
 * A tuning, one of its scales, and a key when the tuning is relative.
 * @typedef {{ tuning: string, scale: string, key?: number }} RetunePitch
 */

/**
 * The frequency of the genome's scale degree 0: its root in the reference's period, or the
 * first note of an absolute tuning's scale, which has no root of its own.
 * @param {RetunePitch} genome
 * @returns {number}
 */
export function rootHz({ tuning: id, scale, key }) {
  const tuning = getTuning(id);
  if (isAbsolute(tuning)) return frequency(resolvePitch(tuning, scale), 0);
  return frequency(resolvePitch(tuning, ALL, key), 0, tuning.reference.octave);
}

/**
 * The key of `tuningId` whose root lies nearest the genome's root, in any period, so a retune
 * keeps the music where it was; the lowest key on a tie. Undefined for an absolute tuning.
 * @param {RetunePitch} genome
 * @param {string} tuningId
 * @returns {number | undefined}
 */
export function nearestKey(genome, tuningId) {
  const tuning = getTuning(tuningId);
  if (isAbsolute(tuning)) return undefined;
  const root = rootHz(genome);
  let best = 0;
  let bestDistance = Infinity;
  for (let key = 0; key < tuning.degrees.length; key++) {
    const pitch = resolvePitch(tuning, ALL, key);
    const { octave } = tuning.reference;
    for (let period = octave - PERIODS_AROUND; period <= octave + PERIODS_AROUND; period++) {
      const distance = Math.abs(Math.log(frequency(pitch, 0, period) / root));
      if (distance < bestDistance) {
        best = key;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * What a retune to `tuningId` offers first: the genome's scale when the tuning has one by that
 * name, else every degree, and the nearest key.
 * @param {RetunePitch} genome
 * @param {string} tuningId
 * @returns {RetunePitch}
 */
export function suggestedPitch(genome, tuningId) {
  const { scales } = getTuning(tuningId);
  const scale = Object.hasOwn(scales, genome.scale) ? genome.scale : ALL;
  const key = nearestKey(genome, tuningId);
  return key === undefined ? { tuning: tuningId, scale } : { tuning: tuningId, scale, key };
}

/**
 * A pitch in words, as a card and a lineage reading name it: `19-edo, scale all, key 5`.
 * @param {RetunePitch} pitch
 */
export const pitchText = ({ tuning, scale, key }) =>
  `${tuning}, scale ${scale}${key === undefined ? "" : `, key ${key}`}`;

/**
 * Whether the genome already plays this pitch.
 * @param {RetunePitch} genome
 * @param {RetunePitch} pitch
 */
export const samePitch = (genome, { tuning, scale, key }) =>
  genome.tuning === tuning && genome.scale === scale && genome.key === key;

/**
 * Why the locks refuse a retune, or null when they don't: applying a lock on the tuning, scale
 * or key would put back the value the retune changed.
 * @param {readonly Lock[]} locks
 * @returns {string | null}
 */
export function retuneRefusal(locks) {
  const held = locks.filter(({ path }) => RETUNE_PATHS.includes(path)).map(({ path }) => path);
  if (held.length === 0) return null;
  return `the brief locks ${held.join(", ")}, so a retune would be undone; remove the lock first`;
}

/**
 * The base with the pitch set, validated, locked, checked against the base and linted against
 * the brief. A pitch whose scale or key its tuning lacks comes back rejected by the schema.
 * Throws when the pitch leaves out the key a relative tuning needs, gives one to an absolute
 * tuning, repeats the base's pitch, or the locks refuse it.
 * @param {object} request
 * @param {Genome} request.base a normalized genome
 * @param {RetunePitch} request.pitch
 * @param {readonly Lock[]} request.locks the vibe's locks in force
 * @param {Constraints} request.constraints the vibe's
 * @returns {Proposal}
 */
export function retune({ base, pitch, locks, constraints }) {
  const relative = !isAbsolute(getTuning(pitch.tuning));
  if (relative !== (pitch.key !== undefined)) {
    throw new Error(
      relative
        ? `${pitch.tuning} is relative, so a retune to it needs a key`
        : `${pitch.tuning} is absolute, so it takes no key`,
    );
  }
  if (samePitch(base, pitch)) throw new Error("the base already plays this tuning, scale and key");
  const refused = retuneRefusal(locks);
  if (refused !== null) throw new Error(refused);
  /** @type {Record<string, unknown>} */
  const written = { ...base, tuning: pitch.tuning, scale: pitch.scale };
  if (relative) written.key = pitch.key;
  else delete written.key;
  const seen = new Map([[canonicalGenome(base), "its base"]]);
  return proposeWritten(written, { locks, constraints, seen });
}

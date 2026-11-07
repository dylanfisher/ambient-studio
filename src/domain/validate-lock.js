// The lock shape (decision 0035) and its check against the genome of the candidate it was taken
// from: the path names something that genome holds, and the value is one the schema allows.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { LockTarget } from "./lock-path.js" */
import { isObject } from "../engine/is-object.js";
import { validateGenome } from "../engine/validate-genome.js";
import { show } from "../engine/validation-error.js";
import { voiceParams } from "../engine/voice-registry.js";
import { LOCK_KIND, parseLockPath, readLockTarget, writeLockTarget } from "./lock-path.js";

/**
 * A value the owner locked, which every genome made in the vibe keeps.
 * @typedef {object} Lock
 * @property {string} path a global parameter (`reverbDecay`), a macro (`macros.space`), a
 *   voice's parameter (`voices.pad.hold`) or a whole voice (`voices.pad`)
 * @property {unknown} value the canonical JSON at the path in the candidate it was locked on: a
 *   number, a choice, a flag, a recording's hash, a whole trajectory or a whole voice
 * @property {string} [voiceType] the voice's type, given exactly when the path is a voice's
 *   parameter: a voice whose type changed has other parameters, so its lock no longer fits
 */

/** @typedef {{ ok: true, lock: Lock } | { ok: false, message: string }} LockValidation */

/** A lock's fields, by name. */
export const LOCK_FIELD = Object.freeze({ path: "path", value: "value", voiceType: "voiceType" });
/** @type {readonly string[]} */
const LOCK_KEYS = Object.values(LOCK_FIELD);
const PATH_FORMS =
  "a lock path is a global parameter (reverbDecay), macros.<name>, voices.<id> or voices.<id>.<parameter>";

/** @param {string} message @returns {LockValidation} */
const refused = (message) => ({ ok: false, message });

/**
 * Why the target doesn't fit the genome, or null when it does.
 * @param {LockTarget} target
 * @param {Genome} genome
 * @param {unknown} voiceType
 * @returns {string | null}
 */
function misfit(target, genome, voiceType) {
  if (target.kind !== LOCK_KIND.voiceParam && voiceType !== undefined) {
    return "only a lock on a voice's parameter names voiceType";
  }
  const globals = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (genome));
  if (target.kind === LOCK_KIND.global && globals[target.name] === undefined) {
    return `the candidate has no ${target.name}`;
  }
  if (target.kind === LOCK_KIND.global || target.kind === LOCK_KIND.macro) return null;
  const voice = genome.voices.find((v) => v.id === target.voiceId);
  if (!voice) return `the candidate has no voice ${show(target.voiceId)}`;
  if (target.kind === LOCK_KIND.voice) return null;
  if (!Object.hasOwn(voiceParams(voice.type), target.name)) {
    return `a ${voice.type} voice has no parameter ${show(target.name)}`;
  }
  if (voiceType !== voice.type) {
    return `voiceType must be ${show(voice.type)}, the type of voice ${show(target.voiceId)} in the candidate, got ${show(voiceType)}`;
  }
  return null;
}

/**
 * Checks a lock against the genome of the candidate it was taken from, and returns it with its
 * value in canonical form: every curve and voice default written out.
 * @param {unknown} lock
 * @param {Genome} genome a normalized genome
 * @returns {LockValidation}
 */
export function validateLock(lock, genome) {
  if (!isObject(lock)) return refused(`a lock must be an object, got ${show(lock)}`);
  const unknown = Object.keys(lock).filter((key) => !LOCK_KEYS.includes(key));
  if (unknown.length > 0) {
    return refused(`unknown keys ${unknown.join(", ")}; a lock has ${LOCK_KEYS.join(", ")}`);
  }
  const { path, value, voiceType } = lock;
  if (typeof path !== "string") return refused(`a lock's path must be a string, got ${show(path)}`);
  const target = parseLockPath(path);
  if (!target) return refused(`${path} names no parameter or voice; ${PATH_FORMS}`);
  if (value === undefined) return refused(`the lock on ${path} has no value`);
  const reason = misfit(target, genome, voiceType);
  if (reason !== null) return refused(`can't lock ${path}: ${reason}`);
  if (target.kind === LOCK_KIND.voice && (!isObject(value) || value.id !== target.voiceId)) {
    return refused(
      `can't lock ${path}: the value must be a voice, and its id must be ${show(target.voiceId)}`,
    );
  }
  // The value is checked where it sits, in a copy of the candidate's genome, so a voice, a
  // trajectory and a parameter that exists only beside another all get the validator's checks.
  const copy = structuredClone(genome);
  writeLockTarget(copy, target, value);
  const checked = validateGenome(copy);
  if (!checked.ok) {
    const list = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    return refused(`can't lock ${path} to ${show(value)}: ${list}`);
  }
  const canonical = readLockTarget(checked.genome, target);
  return {
    ok: true,
    lock: { path, value: canonical, ...(typeof voiceType === "string" && { voiceType }) },
  };
}

/**
 * The lock on `path` with the value the candidate's genome holds there.
 * @param {Genome} genome a normalized genome
 * @param {string} path
 * @returns {LockValidation}
 */
export function lockOn(genome, path) {
  const target = parseLockPath(path);
  if (!target) return refused(`${path} names no parameter or voice; ${PATH_FORMS}`);
  if (target.kind === LOCK_KIND.voiceParam) {
    const voice = genome.voices.find((v) => v.id === target.voiceId);
    if (!voice)
      return refused(`can't lock ${path}: the candidate has no voice ${show(target.voiceId)}`);
    return validateLock(
      { path, value: readLockTarget(genome, target), voiceType: voice.type },
      genome,
    );
  }
  const value = readLockTarget(genome, target);
  if (value === undefined) {
    const what = target.kind === LOCK_KIND.voice ? `voice ${show(target.voiceId)}` : target.name;
    return refused(`can't lock ${path}: the candidate has no ${what}`);
  }
  return validateLock({ path, value }, genome);
}

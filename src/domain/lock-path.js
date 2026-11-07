// What a lock path names, and reading and writing the value there (decision 0035). A path is a
// global parameter (`reverbDecay`), a macro (`macros.space`), a voice's parameter
// (`voices.pad.hold`) or a whole voice (`voices.pad`); a trajectory is locked whole, so no path
// ends in `.start` or `.end`.
/** @import { Genome } from "../engine/genome-schema.js" */
import { GENOME_KEY, GLOBAL_PARAMS, MACROS, VOICE_ID } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";

/** The kinds of thing a lock path names. */
export const LOCK_KIND = Object.freeze({
  global: "global",
  macro: "macro",
  voice: "voice",
  voiceParam: "voiceParam",
});

/**
 * @typedef {{ kind: "global", name: string }
 *   | { kind: "macro", name: string }
 *   | { kind: "voice", voiceId: string }
 *   | { kind: "voiceParam", voiceId: string, name: string }} LockTarget
 */

/**
 * What `path` names, or undefined when it names no global, macro or voice. A voice parameter's
 * name is checked against the voice's type by `validateLock`, which knows the genome.
 * @param {string} path
 * @returns {LockTarget | undefined}
 */
export function parseLockPath(path) {
  const parts = path.split(".");
  const [head = "", second, third, ...rest] = parts;
  if (parts.length === 1) {
    return Object.hasOwn(GLOBAL_PARAMS, head) ? { kind: LOCK_KIND.global, name: head } : undefined;
  }
  if (head === GENOME_KEY.macros && parts.length === 2 && second !== undefined) {
    return Object.hasOwn(MACROS, second) ? { kind: LOCK_KIND.macro, name: second } : undefined;
  }
  if (head !== GENOME_KEY.voices || second === undefined || !VOICE_ID.test(second)) {
    return undefined;
  }
  if (third === undefined) return { kind: LOCK_KIND.voice, voiceId: second };
  if (rest.length > 0 || third === "") return undefined;
  return { kind: LOCK_KIND.voiceParam, voiceId: second, name: third };
}

/**
 * Whether a lock on `lockPath` holds the value at `path`: the same path, or one inside it, as
 * `voices.pad.hold` is inside `voices.pad` and `voices.pad.level.start` inside `voices.pad.level`.
 * @param {string} lockPath
 * @param {string} path
 */
export const lockCovers = (lockPath, path) => path === lockPath || path.startsWith(`${lockPath}.`);

/**
 * The voices of a genome, or of an answer as written, where they are a list.
 * @param {unknown} genome
 * @returns {Record<string, unknown>[]}
 */
function voicesOf(genome) {
  const voices = isObject(genome) ? genome.voices : undefined;
  return Array.isArray(voices) ? voices.filter(isObject) : [];
}

/**
 * The index of the voice with `id` in the genome's list, or -1.
 * @param {unknown} genome
 * @param {string} id
 */
export const voiceIndex = (genome, id) =>
  isObject(genome) && Array.isArray(genome.voices)
    ? genome.voices.findIndex((voice) => isObject(voice) && voice.id === id)
    : -1;

/**
 * The value at the lock's target, or undefined when the genome holds none. Reads an answer as
 * written as well as a normalized genome.
 * @param {unknown} genome
 * @param {LockTarget} target
 * @returns {unknown}
 */
export function readLockTarget(genome, target) {
  if (!isObject(genome)) return undefined;
  if (target.kind === LOCK_KIND.global) return genome[target.name];
  if (target.kind === LOCK_KIND.macro) {
    const macros = genome[GENOME_KEY.macros];
    return isObject(macros) ? macros[target.name] : undefined;
  }
  const voice = voicesOf(genome).find((v) => v.id === target.voiceId);
  if (target.kind === LOCK_KIND.voice) return voice;
  return voice?.[target.name];
}

/**
 * Writes a copy of `value` at the lock's target in `genome`, in place. A whole voice replaces
 * the voice with its id, or is added at the end when the genome has none. Throws on a voice's
 * parameter whose voice the genome lacks.
 * @param {Genome} genome
 * @param {LockTarget} target
 * @param {unknown} value
 */
export function writeLockTarget(genome, target, value) {
  const copy = structuredClone(value);
  /** @type {Record<string, unknown>} */
  const holder = /** @type {any} */ (genome);
  if (target.kind === LOCK_KIND.global) {
    holder[target.name] = copy;
    return;
  }
  if (target.kind === LOCK_KIND.macro) {
    /** @type {Record<string, unknown>} */ (genome.macros)[target.name] = copy;
    return;
  }
  const index = voiceIndex(genome, target.voiceId);
  if (target.kind === LOCK_KIND.voice) {
    if (index === -1) genome.voices.push(/** @type {any} */ (copy));
    else genome.voices[index] = /** @type {any} */ (copy);
    return;
  }
  const voice = genome.voices[index];
  if (!voice)
    throw new Error(`can't write ${target.name}: the genome has no voice "${target.voiceId}"`);
  voice[target.name] = /** @type {any} */ (copy);
}

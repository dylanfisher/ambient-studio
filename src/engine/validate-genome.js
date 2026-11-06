// Checks a genome against the descriptor tables and writes every omitted default out, so a
// stored genome never changes sound when a default changes later (decision 0005).
/** @import { DescriptorTable } from "./descriptor.js" */
/** @import { Genome } from "./genome-schema.js" */
/** @import { ValidationError } from "./validation-error.js" */
import { checkValue } from "./descriptor.js";
import {
  GENOME_KEY,
  GLOBAL_PARAMS,
  MACROS,
  MAX_VOICES,
  SCHEMA_VERSION,
  VOICE_ID,
  VOICE_KEYS,
  VOICE_PARAMS,
} from "./genome-schema.js";
import { isObject } from "./is-object.js";
import { isAbsolute } from "./tuning.js";
import { getTuning } from "./tuning-registry.js";
import { checkKeys, show } from "./validation-error.js";
import { findVoiceType, voiceTypeIds } from "./voice-registry.js";

/** @typedef {{ ok: true, genome: Genome } | { ok: false, errors: ValidationError[] }} Validation */

/** @typedef {Record<string, unknown>} Fields */

const GENOME_KEYS = Object.values(GENOME_KEY);

/**
 * Checks `input` against a table and returns its values with defaults written out. A parameter
 * whose `when` doesn't apply is left out, and is an error if given.
 * @param {DescriptorTable} table
 * @param {Fields} input
 * @param {string} path
 * @param {ValidationError[]} errors
 * @param {readonly string[]} otherKeys keys the caller checks itself
 */
function checkTable(table, input, path, errors, otherKeys = []) {
  checkKeys(input, (key) => Object.hasOwn(table, key) || otherKeys.includes(key), path, errors);
  /** @type {Fields} */
  const out = {};
  const entries = Object.entries(table);
  // Parameters with `when` read the others' checked values, so they go second.
  for (const [name, descriptor] of [
    ...entries.filter(([, d]) => !d.when),
    ...entries.filter(([, d]) => d.when),
  ]) {
    const given = input[name];
    const applies = descriptor.when ? descriptor.when.applies(out) : true;
    if (applies === undefined) continue;
    if (!applies) {
      if (given !== undefined) {
        errors.push({ path: `${path}.${name}`, message: `allowed only ${descriptor.when?.text}` });
      }
      continue;
    }
    const value =
      given === undefined
        ? descriptor.default
        : checkValue(descriptor, given, `${path}.${name}`, errors);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Scale and key against the chosen tuning: one of its own scales, and a key within its degrees.
 * @param {Fields} input
 * @param {Fields} out the checked globals
 * @param {ValidationError[]} errors
 */
function checkPitch(input, out, errors) {
  if (out.tuning === undefined) return;
  const tuning = getTuning(/** @type {string} */ (out.tuning));
  const scale = /** @type {string | undefined} */ (out.scale);
  if (scale !== undefined && !Object.hasOwn(tuning.scales, scale)) {
    const names = Object.keys(tuning.scales).join(", ");
    const omitted = input.scale === undefined ? " (the default)" : "";
    errors.push({
      path: "$.scale",
      message: `"${scale}"${omitted} is not a scale of ${tuning.id}; it has ${names}`,
    });
  }
  const key = /** @type {number | undefined} */ (out.key);
  if (!isAbsolute(tuning) && key !== undefined && key >= tuning.degrees.length) {
    const top = tuning.degrees.length - 1;
    errors.push({
      path: "$.key",
      message: `must be from 0 to ${top} for ${tuning.id}, got ${key}`,
    });
  }
}

/**
 * @param {unknown} input
 * @param {string} path
 * @param {Map<string, string>} ids voice id → path of the voice that took it
 * @param {ValidationError[]} errors
 */
function checkVoice(input, path, ids, errors) {
  if (!isObject(input)) {
    errors.push({ path, message: "must be an object" });
    return undefined;
  }
  const { id, type } = input;
  if (id === undefined) {
    errors.push({ path: `${path}.id`, message: `missing; give an id matching ${VOICE_ID.source}` });
  } else if (typeof id !== "string" || !VOICE_ID.test(id)) {
    errors.push({ path: `${path}.id`, message: `must match ${VOICE_ID.source}, got ${show(id)}` });
  } else if (ids.has(id)) {
    errors.push({ path: `${path}.id`, message: `${show(id)} is already used by ${ids.get(id)}` });
  } else {
    ids.set(id, path);
  }

  const voiceType = typeof type === "string" ? findVoiceType(type) : undefined;
  if (type === undefined) {
    errors.push({ path: `${path}.type`, message: "missing; give a voice type" });
  } else if (!voiceType) {
    const known = JSON.stringify(voiceTypeIds());
    errors.push({
      path: `${path}.type`,
      message: `unknown voice type ${show(type)}; known: ${known}`,
    });
  }

  // Without a known type its own parameters can't be told from unknown keys, so only the
  // common ones are checked.
  const params = voiceType
    ? checkTable({ ...VOICE_PARAMS, ...voiceType.params }, input, path, errors, VOICE_KEYS)
    : checkTable(
        VOICE_PARAMS,
        Object.fromEntries(Object.keys(VOICE_PARAMS).map((name) => [name, input[name]])),
        path,
        errors,
      );
  const { start, end } = params;
  if (typeof start === "number" && typeof end === "number" && end <= start) {
    errors.push({ path: `${path}.end`, message: `must be after start (${start} s), got ${end}` });
  }
  return { id, type, ...params };
}

/**
 * Returns the normalized genome with every default written out, or every error found.
 * @param {unknown} value
 * @returns {Validation}
 */
export function validateGenome(value) {
  if (!isObject(value)) return { ok: false, errors: [{ path: "$", message: "must be an object" }] };
  /** @type {ValidationError[]} */
  const errors = [];
  const { schemaVersion = SCHEMA_VERSION, macros = {}, voices = [] } = value;
  const globals = checkTable(GLOBAL_PARAMS, value, "$", errors, GENOME_KEYS);
  if (schemaVersion !== SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `must be ${SCHEMA_VERSION}; migrate an older genome first, got ${show(schemaVersion)}`,
    });
  }
  checkPitch(value, globals, errors);
  const { duration, fadeIn, fadeOut } = globals;
  if (
    typeof duration === "number" &&
    typeof fadeIn === "number" &&
    typeof fadeOut === "number" &&
    fadeIn + fadeOut > duration
  ) {
    errors.push({
      path: "$.fadeOut",
      message: `fadeIn + fadeOut must be at most duration (${duration} s), got ${fadeIn + fadeOut} s`,
    });
  }

  let checkedMacros = {};
  if (isObject(macros)) checkedMacros = checkTable(MACROS, macros, "$.macros", errors);
  else errors.push({ path: "$.macros", message: "must be an object" });

  /** @type {unknown[]} */
  let checkedVoices = [];
  if (Array.isArray(voices) && voices.length > MAX_VOICES) {
    errors.push({ path: "$.voices", message: `must hold at most ${MAX_VOICES} voices` });
  } else if (Array.isArray(voices)) {
    /** @type {Map<string, string>} */
    const ids = new Map();
    checkedVoices = voices.map((voice, i) => checkVoice(voice, `$.voices[${i}]`, ids, errors));
  } else {
    errors.push({ path: "$.voices", message: "must be a list" });
  }

  if (errors.length > 0) return { ok: false, errors };
  const genome = { schemaVersion, ...globals, macros: checkedMacros, voices: checkedVoices };
  return { ok: true, genome: /** @type {Genome} */ (genome) };
}

/**
 * The normalized genome, for callers that hold a genome they expect to be valid. Throws with
 * every error listed after `context`.
 * @param {unknown} value
 * @param {string} context what the caller was doing, put before the error list
 * @returns {Genome}
 */
export function requireGenome(value, context) {
  const result = validateGenome(value);
  if (result.ok) return result.genome;
  const list = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
  throw new Error(`${context}: ${list}`);
}

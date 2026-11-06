// Checks a vibe's constraint set against its table, every error with its JSON path, as
// `validateGenome` does for a genome (decisions 0005 and 0020).
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { ConstraintKind, Constraints } from "./constraint-schema.js" */
import { checkValue } from "../engine/descriptor.js";
import { isObject } from "../engine/is-object.js";
import { checkKeys, show } from "../engine/validation-error.js";
import { voiceTypeIds } from "../engine/voice-registry.js";
import { CONSTRAINT_KINDS, FORM } from "./constraint-schema.js";

/**
 * @typedef {{ ok: true, constraints: Constraints } | { ok: false, errors: ValidationError[] }} ConstraintsValidation
 */

const RANGE_ENDS = Object.freeze(["min", "max"]);

/**
 * @param {Descriptor} descriptor
 * @param {unknown} given
 * @param {string} path
 * @param {ValidationError[]} errors
 */
function checkRange(descriptor, given, path, errors) {
  if (!isObject(given)) {
    errors.push({ path, message: `must be an object with min and max, got ${show(given)}` });
    return;
  }
  checkKeys(given, (key) => RANGE_ENDS.includes(key), path, errors);
  const [min, max] = RANGE_ENDS.map((end) => {
    if (given[end] !== undefined) {
      return checkValue(descriptor, given[end], `${path}.${end}`, errors);
    }
    errors.push({ path: `${path}.${end}`, message: "missing" });
    return undefined;
  });
  if (typeof min === "number" && typeof max === "number" && min > max) {
    errors.push({ path, message: `min ${min} is above max ${max}` });
  }
}

/**
 * @param {unknown} given
 * @param {string} path
 * @param {ValidationError[]} errors
 */
function checkVoiceList(given, path, errors) {
  if (!Array.isArray(given) || given.length === 0) {
    errors.push({ path, message: `must list at least one voice type, got ${show(given)}` });
    return;
  }
  const known = voiceTypeIds();
  given.forEach((type, i) => {
    const at = `${path}[${i}]`;
    if (typeof type !== "string" || !known.includes(type)) {
      errors.push({
        path: at,
        message: `unknown voice type ${show(type)}; known: ${JSON.stringify(known)}`,
      });
    } else if (given.indexOf(type) < i) {
      errors.push({ path: at, message: `${show(type)} is listed twice` });
    }
  });
}

/**
 * Returns the constraint set, or every error found. A kind's checks against the others (a scale
 * against a fixed tuning) run only when both passed their own.
 * @param {unknown} value
 * @returns {ConstraintsValidation}
 */
export function validateConstraints(value) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (!isObject(value)) {
    errors.push({
      path: "$",
      message: `must be an object of constraint kinds, got ${show(value)}`,
    });
    return { ok: false, errors };
  }
  checkKeys(value, (key) => Object.hasOwn(CONSTRAINT_KINDS, key), "$", errors);
  /** @type {Record<string, unknown>} */
  const passed = {};
  for (const [name, kind] of Object.entries(CONSTRAINT_KINDS)) {
    const given = value[name];
    if (given === undefined) continue;
    const path = `$.${name}`;
    const before = errors.length;
    const descriptor = /** @type {Descriptor} */ (kind.value);
    if (kind.form === FORM.voices) checkVoiceList(given, path, errors);
    else if (kind.form === FORM.range) checkRange(descriptor, given, path, errors);
    else checkValue(descriptor, given, path, errors);
    if (errors.length === before) passed[name] = given;
  }
  for (const [name, kind] of Object.entries(CONSTRAINT_KINDS)) {
    const { across } = /** @type {ConstraintKind<unknown>} */ (kind);
    if (!across || passed[name] === undefined) continue;
    for (const message of across(passed[name], passed)) {
      errors.push({ path: `$.${name}`, message });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, constraints: /** @type {Constraints} */ ({ ...value }) };
}

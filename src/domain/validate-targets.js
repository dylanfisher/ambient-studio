// Checks a vibe revision's soft targets: the feature ranges at `features` against the range
// table, every error with its JSON path, as `validateConstraints` does for the constraints
// (decisions 0020 and 0034). Other keys are kept as saved and not checked.
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { FeatureRanges, SoftTargets, TargetFeature } from "./target-schema.js" */
import { isObject } from "../engine/is-object.js";
import { show } from "../engine/validation-error.js";
import { RANGE_BOUNDS, RANGE_ENDS, RANGES_KEY, TARGET_FEATURES } from "./target-schema.js";

/**
 * @typedef {{ ok: true, softTargets: SoftTargets, ranges: FeatureRanges }
 *   | { ok: false, errors: ValidationError[] }} TargetsValidation
 */

/**
 * One end: null, or a number inside the feature's bounds.
 * @param {TargetFeature} bounds
 * @param {unknown} end
 * @param {string} path
 * @param {ValidationError[]} errors
 * @returns {boolean} whether it passed
 */
function checkEnd({ least, most }, end, path, errors) {
  if (end === null) return true;
  if (typeof end !== "number" || !Number.isFinite(end)) {
    errors.push({ path, message: `must be a number, or null for an open end; got ${show(end)}` });
    return false;
  }
  if (end < least || (most !== null && end > most)) {
    const allowed = most === null ? `at least ${least}` : `from ${least} to ${most}`;
    errors.push({ path, message: `must be ${allowed}, got ${end}` });
    return false;
  }
  return true;
}

/**
 * @param {string} name
 * @param {unknown} range
 * @param {string} path
 * @param {ValidationError[]} errors
 */
function checkRange(name, range, path, errors) {
  if (!Object.hasOwn(TARGET_FEATURES, name)) {
    errors.push({
      path,
      message: Object.hasOwn(RANGE_BOUNDS, name)
        ? "is a raw level, which normalize cancels before the excerpt is heard, so it takes no range"
        : `unknown feature; known: ${Object.keys(TARGET_FEATURES).join(", ")}`,
    });
    return;
  }
  const feature = /** @type {TargetFeature} */ (TARGET_FEATURES[name]);
  if (!Array.isArray(range) || range.length !== RANGE_ENDS.length) {
    errors.push({ path, message: `must be [low, high], got ${show(range)}` });
    return;
  }
  const [low, high] = range;
  const passed = range.map((end, i) => checkEnd(feature, end, `${path}[${i}]`, errors));
  if (!passed.every(Boolean)) return;
  if (low === null && high === null) {
    errors.push({ path, message: "has both ends open; leave the feature out for no range" });
  } else if (low !== null && high !== null && low > high) {
    errors.push({ path, message: `low ${low} is above high ${high}` });
  }
}

/**
 * Returns the soft targets with their ranges, or every error found. `{}` is valid and has no
 * ranges.
 * @param {unknown} value
 * @returns {TargetsValidation}
 */
export function validateTargets(value) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (!isObject(value)) {
    errors.push({ path: "$", message: `must be an object, {} for none, got ${show(value)}` });
    return { ok: false, errors };
  }
  const given = value[RANGES_KEY];
  const path = `$.${RANGES_KEY}`;
  if (given !== undefined) {
    if (isObject(given)) {
      for (const [name, range] of Object.entries(given)) {
        checkRange(name, range, `${path}.${name}`, errors);
      }
    } else {
      errors.push({
        path,
        message: `must be an object of feature ranges, got ${show(given)}`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const softTargets = /** @type {SoftTargets} */ ({ ...value });
  return { ok: true, softTargets, ranges: softTargets.features ?? {} };
}

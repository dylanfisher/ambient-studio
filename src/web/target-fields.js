// The brief page's feature-range form, read from 3b's range table (decision 0034) so a new
// feature gets its field with no change here. No DOM: the page builds inputs from
// `targetFields`, and reads them back with `readTargets` for `validateTargets` to check.
/** @import { FeatureRanges } from "../domain/target-schema.js" */
import { RANGE_ENDS, RANGES_KEY, TARGET_FEATURES } from "../domain/target-schema.js";

/**
 * One feature's two inputs, named by `targetInput`.
 * @typedef {object} TargetField
 * @property {string} name the feature's key in the stored ranges
 * @property {string} label
 * @property {string | null} unit null for a share from 0 to 1
 * @property {number} least the lowest an end may be
 * @property {number | null} most the highest an end may be, or null for no bound
 */

/** @typedef {(typeof RANGE_ENDS)[number]} End */

/**
 * The input's name. The prefix keeps it apart from the constraint inputs in the same form.
 * @param {string} name
 * @param {End} end
 */
export const targetInput = (name, end) => `target.${name}.${end}`;

/** @returns {TargetField[]} one per feature, in the table's order */
export const targetFields = () =>
  Object.entries(TARGET_FEATURES).map(([name, { feature, least, most }]) => ({
    name,
    label: feature.label,
    unit: feature.unit,
    least,
    most,
  }));

/**
 * An end's text as the number it says, null when it's empty, or the text itself when it says
 * none, so the validator names it.
 * @param {string} text
 * @returns {number | string | null}
 */
function parsed(text) {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
}

/**
 * The saved soft targets other than the ranges, which the form keeps and doesn't edit.
 * @param {Readonly<Record<string, unknown>>} softTargets
 * @returns {Record<string, unknown>}
 */
export function keptTargets(softTargets) {
  const { [RANGES_KEY]: _ranges, ...kept } = softTargets;
  return kept;
}

/**
 * The soft targets to save: the saved ones' other keys, and the ranges the form holds. A
 * feature with both ends empty has no range and is left out, and with no ranges at all there
 * is no `features` key, so `{}` stays `{}`.
 * @param {(name: string) => string} get an input's value, "" when empty
 * @param {Readonly<Record<string, unknown>>} saved the revision's soft targets, `{}` for a new
 *   brief
 * @returns {Record<string, unknown>}
 */
export function readTargets(get, saved) {
  /** @type {Record<string, unknown[]>} */
  const ranges = {};
  for (const { name } of targetFields()) {
    const range = RANGE_ENDS.map((end) => parsed(get(targetInput(name, end))));
    if (range.some((end) => end !== null)) ranges[name] = range;
  }
  const kept = keptTargets(saved);
  return Object.keys(ranges).length === 0 ? kept : { ...kept, [RANGES_KEY]: ranges };
}

/**
 * The form's values for stored ranges, named as `readTargets` reads them; an open end is "".
 * @param {FeatureRanges} ranges
 * @returns {Record<string, string>}
 */
export function targetValues(ranges) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const { name } of targetFields()) {
    const range = ranges[name];
    if (range === undefined) continue;
    range.forEach((end, i) => {
      values[targetInput(name, /** @type {End} */ (RANGE_ENDS[i]))] =
        end === null ? "" : String(end);
    });
  }
  return values;
}

/**
 * An end's title: what it bounds, the values it takes, and what leaving it empty does.
 * @param {TargetField} field
 * @param {End} end
 */
export function targetTitle({ label, unit, least, most }, end) {
  const values = most === null ? `at least ${least}` : `from ${least} to ${most}`;
  const [low] = RANGE_ENDS;
  const [side, open] = end === low ? ["lowest", "lower"] : ["highest", "upper"];
  return `The ${side} ${label} the model should aim for, ${values}${unit ? ` ${unit}` : ""}, measured on each excerpt. Leave it empty for no ${open} end.`;
}

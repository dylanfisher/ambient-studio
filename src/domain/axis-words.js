// How a map axis is said in plain words (decision 0057): its name on the map and the brief page,
// and the way toward either of its ends, which the fill job sends as an explore's direction
// toward an empty cell. No DOM, so the server and the pages read the same words.
import { AXIS_SOURCE } from "./attachment-kind.js";
import { DIRECTION_CHARS } from "./explore-direction.js";
import { MACRO_DIRECTIONS } from "./rating-values.js";
import { TARGET_FEATURES } from "./target-schema.js";

/**
 * An axis as the archive route gives it: its source and what names it.
 * @typedef {object} AxisSource
 * @property {string} source an `AXIS_SOURCE` value
 * @property {string} [name] the name of a feature or a macro
 * @property {string | null} [near] a direction's near end; null for the brief's description
 * @property {string} [far] a direction's far end
 * @property {string} [label] a region's label
 */

const [MORE, LESS] = MACRO_DIRECTIONS;

/**
 * A direction's near end in words: quoted, or the brief's description when it has none.
 * @param {string | null | undefined} near
 */
export const nearText = (near) => (near == null ? "the brief's description" : `“${near}”`);

/**
 * The axis's name, as the map and the brief page give it.
 * @param {AxisSource} axis
 * @returns {string}
 */
export function axisName({ source, name, near, far, label }) {
  if (source === AXIS_SOURCE.feature) {
    const entry = TARGET_FEATURES[/** @type {string} */ (name)];
    if (!entry) throw new Error(`there is no ranged feature ${JSON.stringify(name)}`);
    const { label: words, unit } = entry.feature;
    return unit === null ? words : `${words} (${unit})`;
  }
  if (source === AXIS_SOURCE.macro) return `${name} (the macro, over the excerpt)`;
  if (source === AXIS_SOURCE.direction) return `${nearText(near)} to “${far}”`;
  if (source === AXIS_SOURCE.region) return `nearness to the region “${label}”`;
  throw new Error(`there is no axis source ${JSON.stringify(source)}`);
}

/**
 * The axis's high end (`sign` 1) or its low end (−1) in words: a lower spectral centroid,
 * more space, a sound more like the far end.
 * @param {AxisSource} axis
 * @param {-1 | 1} sign
 * @returns {string}
 */
export function endWords(axis, sign) {
  const up = sign > 0;
  const { source, name, near, far, label } = axis;
  if (source === AXIS_SOURCE.feature) {
    const entry = TARGET_FEATURES[/** @type {string} */ (name)];
    return `${up ? "a higher" : "a lower"} ${entry?.feature.label ?? name}`;
  }
  if (source === AXIS_SOURCE.macro) return `${up ? MORE : LESS} ${name}`;
  if (source === AXIS_SOURCE.direction) {
    return `a sound more like ${up ? `“${far}”` : nearText(near)}`;
  }
  if (source === AXIS_SOURCE.region) {
    return `a sound ${up ? "nearer to" : "further from"} the region “${label}”`;
  }
  throw new Error(`there is no axis source ${JSON.stringify(source)}`);
}

/**
 * The way toward the axis's high end (`sign` 1) or its low end (−1), one line of at most
 * `DIRECTION_CHARS` characters, as an explore's direction.
 * @param {AxisSource} axis
 * @param {-1 | 1} sign
 * @returns {string}
 */
export const towardText = (axis, sign) =>
  `Toward ${endWords(axis, sign)}`.slice(0, DIRECTION_CHARS);

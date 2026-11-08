// The brief page's choices for the map's axes (decision 0057), with no DOM: every ranged
// feature, every macro, each of the brief's directions and each region attached to it, the
// body the axes route takes, and the line that says what is chosen now.
import { AXIS_SOURCE } from "../domain/attachment-kind.js";
import { axisName } from "../domain/axis-words.js";
import { TARGET_FEATURES } from "../domain/target-schema.js";
import { MACROS } from "../engine/genome-schema.js";

/** No third axis. */
export const NO_AXIS = "";

/**
 * What a brief starts its map on before the owner chooses: dark to bright across, static to
 * evolving up, as spectral centroid by loudness range.
 */
export const SUGGESTED_AXES = Object.freeze(["feature:centroidMean", "feature:loudnessRange"]);

/**
 * @typedef {object} AxisChoice
 * @property {string} value the select's value
 * @property {string} text
 * @property {Record<string, unknown>} axis what the axes route takes for it
 */

/**
 * The value of a stored axis or a choice: its source and what names it.
 * @param {{ source: string, name?: unknown, directionId?: unknown, regionId?: unknown }} axis
 */
export function axisValue({ source, name, directionId, regionId }) {
  if (source === AXIS_SOURCE.direction) return `${source}:${directionId}`;
  if (source === AXIS_SOURCE.region) return `${source}:${regionId}`;
  return `${source}:${name}`;
}

/**
 * Every axis the brief can take, in the order the selects list them.
 * @param {readonly { id: number, near: string | null, far: string }[]} directions the brief's
 * @param {readonly { regionId: number, label: string }[]} references the regions attached to it
 * @returns {AxisChoice[]}
 */
export function axisChoices(directions, references) {
  /** @param {Record<string, unknown>} axis @param {Record<string, unknown>} [words] */
  const choice = (axis, words = {}) => ({
    value: axisValue(/** @type {{ source: string }} */ (axis)),
    text: axisName(/** @type {{ source: string }} */ ({ ...axis, ...words })),
    axis,
  });
  return [
    ...Object.keys(TARGET_FEATURES).map((name) => choice({ source: AXIS_SOURCE.feature, name })),
    ...Object.keys(MACROS).map((name) => choice({ source: AXIS_SOURCE.macro, name })),
    ...directions.map(({ id, near, far }) =>
      choice({ source: AXIS_SOURCE.direction, directionId: id }, { near, far }),
    ),
    ...references.map(({ regionId, label }) =>
      choice({ source: AXIS_SOURCE.region, regionId }, { label }),
    ),
  ];
}

/**
 * The axes route's body from the selects' values, or the reason they can't be sent.
 * @param {readonly string[]} values one per select; `NO_AXIS` for none
 * @param {readonly AxisChoice[]} choices
 * @returns {{ axes: Record<string, unknown>[] } | string}
 */
export function chosenAxes(values, choices) {
  const picked = values.filter((value) => value !== NO_AXIS);
  if (picked.length < 2) return "Choose at least the first two axes.";
  if (new Set(picked).size !== picked.length) return "Choose a different thing for each axis.";
  const axes = picked.map((value) => choices.find((choice) => choice.value === value)?.axis);
  if (axes.some((axis) => axis === undefined))
    return "One of the chosen axes isn't offered any more.";
  return { axes: /** @type {Record<string, unknown>[]} */ (axes) };
}

/**
 * The line saying what the brief's map is on now.
 * @param {readonly Parameters<typeof axisValue>[0][]} axes the stored ones, oldest first
 * @param {readonly AxisChoice[]} choices
 * @returns {string}
 */
export function axesLine(axes, choices) {
  if (axes.length === 0) {
    return "No axes chosen yet, so the map page has nothing to show. The selects start on a suggestion: dark to bright, by static to evolving.";
  }
  const named = axes.map(
    (axis) =>
      choices.find((choice) => choice.value === axisValue(axis))?.text ??
      "an axis no longer offered",
  );
  return `The map is on ${named.join(" by ")}.`;
}

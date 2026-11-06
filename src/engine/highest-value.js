// The highest effective value a voice parameter reaches anywhere on the timeline, for a cost
// that must bound every window (decision 0010).
/** @import { NumberDescriptor } from "./descriptor.js" */
/** @import { Genome, ParamValue } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Trajectory } from "./trajectory.js" */
import { decode, encode } from "./descriptor.js";
import { isObject } from "./is-object.js";

/**
 * A number's value, or a trajectory's point values. Every curve moves monotonically from one
 * point to the next (decision 0007), so a trajectory's extremes are at its points.
 * @param {ParamValue} value
 */
const pointValues = (value) =>
  isObject(value)
    ? /** @type {Trajectory} */ (value).points.map((point) => point[1])
    : [/** @type {number} */ (value)];

/**
 * The highest value `effectiveParams` can give the voice's parameter `name`: its own highest
 * value, shifted by each macro row on it with the macro at its highest (or, for a negative
 * depth, its lowest), clamped to the range.
 * @param {Genome} genome
 * @param {Readonly<Record<string, unknown>>} voice
 * @param {string} name
 * @param {NumberDescriptor} descriptor
 * @param {readonly MacroRow[]} rows the voice type's macro rows
 */
export function highestValue(genome, voice, name, descriptor, rows) {
  const raw = Math.max(...pointValues(/** @type {ParamValue} */ (voice[name])));
  let shift = 0;
  for (const { macro, param, depth } of rows) {
    if (param !== name) continue;
    const values = pointValues(genome.macros[macro]);
    const reached = depth > 0 ? Math.max(...values) : Math.min(...values);
    shift += depth * (reached - 0.5) * 2;
  }
  return shift === 0 ? raw : decode(descriptor, encode(descriptor, raw) + shift);
}

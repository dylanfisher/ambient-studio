/** @import { Scale } from "../engine/descriptor.js" */
/** @import { Trajectory } from "../engine/trajectory.js" */
import { isObject } from "../engine/is-object.js";
import { valueAt } from "../engine/trajectory.js";

/**
 * The lowest and highest value a parameter takes from `from` to `to` on the timeline. Every
 * curve moves monotonically from one point to the next (decision 0007), so the extremes are at
 * the interval's ends or at the points inside it.
 * @param {number | Trajectory} value
 * @param {number} from seconds on the timeline
 * @param {number} to seconds on the timeline, at or after `from`
 * @param {Scale} scale the parameter's scale
 * @returns {[number, number]}
 */
export function valueRange(value, from, to, scale) {
  if (!isObject(value)) return [value, value];
  const inside = value.points.filter(([time]) => time > from && time < to);
  const values = [
    valueAt(value, from, scale),
    valueAt(value, to, scale),
    ...inside.map((point) => point[1]),
  ];
  return [Math.min(...values), Math.max(...values)];
}

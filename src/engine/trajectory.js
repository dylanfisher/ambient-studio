// The trajectory shape the validator accepts. Step 1d owns trajectories (decision 0007) and
// replaces this minimal form, its text and its check together; no stored genome holds one yet.
/** @import { ValidationError } from "./validation-error.js" */
import { checkKeys, show } from "./validation-error.js";

/**
 * Breakpoints as [seconds on the genome's timeline, value], times rising.
 * @typedef {{ points: [number, number][] }} Trajectory
 */

/** Most breakpoints a trajectory may hold; a cap added later would invalidate stored genomes. */
const MAX_POINTS = 64;

/** One line for the LLM's schema text. */
export const TRAJECTORY_TEXT = `{"points":[[seconds,value],...]}, up to ${MAX_POINTS}, timeline seconds rising`;

/**
 * Checks a trajectory and returns a copy of it, pushing an error for each problem.
 * @param {Record<string, unknown>} value
 * @param {string} path
 * @param {(value: unknown, path: string) => number | undefined} checkPoint checks one value
 *   against the parameter's descriptor, pushing its own error and returning undefined if invalid
 * @param {ValidationError[]} errors
 * @returns {Trajectory | undefined}
 */
export function checkTrajectory(value, path, checkPoint, errors) {
  const before = errors.length;
  checkKeys(value, (key) => key === "points", path, errors);
  const { points } = value;
  if (!Array.isArray(points) || points.length === 0) {
    errors.push({
      path: `${path}.points`,
      message: "must be a list of at least one [seconds, value]",
    });
    return undefined;
  }
  if (points.length > MAX_POINTS) {
    errors.push({ path: `${path}.points`, message: `must hold at most ${MAX_POINTS} points` });
    return undefined;
  }
  /** @type {[number, number][]} */
  const checked = [];
  let previous = -Infinity;
  points.forEach((point, i) => {
    const at = `${path}.points[${i}]`;
    if (!Array.isArray(point) || point.length !== 2) {
      errors.push({ path: at, message: "must be [seconds, value]" });
      return;
    }
    const [time, raw] = point;
    if (!Number.isFinite(time) || time < 0) {
      errors.push({ path: `${at}[0]`, message: `must be seconds from 0, got ${show(time)}` });
    } else if (!(time > previous)) {
      errors.push({
        path: `${at}[0]`,
        message: `times must rise, but ${time} follows ${previous}`,
      });
    } else {
      previous = time;
    }
    const checkedValue = checkPoint(raw, `${at}[1]`);
    if (checkedValue !== undefined) checked.push([time, checkedValue]);
  });
  return errors.length === before ? { points: checked } : undefined;
}

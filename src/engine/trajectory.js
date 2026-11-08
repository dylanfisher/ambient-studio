// A parameter's value over the genome's timeline: breakpoints with a curve per segment
// (decision 0007). Validation and evaluation live together so they agree on the shape.
/** @import { Scale } from "./descriptor.js" */
/** @import { ValidationError } from "./validation-error.js" */
import { MAX_DURATION } from "./timeline.js";
import { checkKeys, show } from "./validation-error.js";

/**
 * Each curve maps the fraction of a segment's time elapsed to the fraction of its change made,
 * fixing 0 and 1 exactly. Plain arithmetic, so every JS engine computes the same values.
 */
export const CURVES = Object.freeze({
  linear: (/** @type {number} */ x) => x,
  smooth: (/** @type {number} */ x) => x * x * (3 - 2 * x),
  early: (/** @type {number} */ x) => x * (2 - x),
  late: (/** @type {number} */ x) => x * x,
});

/** @typedef {keyof typeof CURVES} Curve */

/** The curve of a segment whose arriving point names none. */
export const DEFAULT_CURVE = "linear";

/**
 * Breakpoints as [seconds on the genome's timeline, value], times rising. Every point after the
 * first also names the curve of the segment that arrives at it.
 * @typedef {{ points: [[number, number], ...[number, number, Curve][]] }} Trajectory
 */

/** Most breakpoints a trajectory may hold; a cap added later would invalidate stored genomes. */
export const MAX_POINTS = 64;

const curveNames = Object.keys(CURVES);

/** The one key of a trajectory object, named in the LLM's schema text. */
export const POINTS_KEY = "points";

/** One line for the LLM's schema text. */
export const TRAJECTORY_TEXT = `up to ${MAX_POINTS} points [seconds,value,curve], timeline seconds rising; optional curve, ramp into the point: ${curveNames.join("|")}, =${DEFAULT_CURVE}; held past the ends`;

/** @param {unknown} value @returns {value is Curve} */
const isCurve = (value) => typeof value === "string" && Object.hasOwn(CURVES, value);

/**
 * Checks a trajectory and returns a copy with every curve written out, pushing an error for
 * each problem.
 * @param {Record<string, unknown>} value
 * @param {string} path
 * @param {(value: unknown, path: string) => number | undefined} checkPoint checks one value
 *   against the parameter's descriptor, pushing its own error and returning undefined if invalid
 * @param {ValidationError[]} errors
 * @returns {Trajectory | undefined}
 */
export function checkTrajectory(value, path, checkPoint, errors) {
  const before = errors.length;
  checkKeys(value, (key) => key === POINTS_KEY, path, errors);
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
  /** @type {[number, number, Curve][]} */
  const checked = [];
  let previous = -Infinity;
  points.forEach((point, i) => {
    const at = `${path}.points[${i}]`;
    if (!Array.isArray(point) || point.length < 2 || point.length > 3) {
      errors.push({ path: at, message: "must be [seconds, value] or [seconds, value, curve]" });
      return;
    }
    const [time, raw, curve = DEFAULT_CURVE] = point;
    if (typeof time !== "number" || !(time >= 0 && time <= MAX_DURATION)) {
      errors.push({
        path: `${at}[0]`,
        message: `must be seconds from 0 to ${MAX_DURATION}, got ${show(time)}`,
      });
    } else if (!(time > previous)) {
      errors.push({
        path: `${at}[0]`,
        message: `times must rise, but ${time} follows ${previous}`,
      });
    } else {
      previous = time;
    }
    if (i === 0 && point.length === 3) {
      errors.push({
        path: `${at}[2]`,
        message: "the first point has no segment before it; give [seconds, value]",
      });
    } else if (!isCurve(curve)) {
      const names = curveNames.map((name) => JSON.stringify(name)).join(", ");
      errors.push({ path: `${at}[2]`, message: `must be one of ${names}, got ${show(curve)}` });
    }
    const checkedValue = checkPoint(raw, `${at}[1]`);
    if (checkedValue !== undefined && isCurve(curve)) checked.push([time, checkedValue, curve]);
  });
  if (errors.length > before) return undefined;
  const [[time, first], ...rest] =
    /** @type {[[number, number, Curve], ...[number, number, Curve][]]} */ (checked);
  return { points: [[time, first], ...rest] };
}

/**
 * The trajectory's value at a time on the timeline. Exact at each breakpoint; between two, the
 * arriving point's curve shapes the move along the parameter's scale, so on a log scale an even
 * curve is an even move in octaves. Before the first point and after the last, the nearest
 * point's value holds.
 * @param {Trajectory} trajectory
 * @param {number} time seconds on the timeline
 * @param {Scale} scale
 * @returns {number}
 */
export function valueAt(trajectory, time, scale) {
  if (!Number.isFinite(time)) throw new RangeError(`trajectory time must be finite, got ${time}`);
  const { points } = trajectory;
  const [[t0, v0]] = points;
  if (time <= t0) return v0;
  for (let i = 1; i < points.length; i++) {
    const [t1, v1, curve] = /** @type {[number, number, Curve]} */ (points[i]);
    if (time < t1) {
      const [ta, va] = /** @type {[number, number]} */ (points[i - 1]);
      // At the segment's start the fraction is 0, which returns `va` exactly on either scale.
      const f = CURVES[curve]((time - ta) / (t1 - ta));
      return scale === "log" ? va * (v1 / va) ** f : va + (v1 - va) * f;
    }
  }
  return /** @type {[number, number]} */ (points.at(-1))[1];
}

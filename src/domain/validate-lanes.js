// Checks an arrangement's macro lanes (decision 0065) for `validateArrangement`, each error with
// its JSON path: at most one lane per macro, each its breakpoints in track seconds, rising, every
// one after the first naming its curve, each offset from −0.5 to 0.5.
/** @import { ValidationError } from "../engine/validation-error.js" */
import { checkValue } from "../engine/descriptor.js";
import { MACROS } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { CURVES } from "../engine/trajectory.js";
import { checkKeys, MISSING, show } from "../engine/validation-error.js";
import { ARRANGEMENT_KEY } from "./arrangement-schema.js";
import { LANE_FIELDS, LANE_MOST_POINTS, LANE_OFFSET, LANE_TIME } from "./lane-schema.js";

/** @param {Record<string, unknown>} names */
const listed = (names) =>
  Object.keys(names)
    .map((name) => JSON.stringify(name))
    .join(", ");

/**
 * Checks one lane's breakpoints.
 * @param {unknown} points
 * @param {string} path
 * @param {ValidationError[]} errors
 */
function checkPoints(points, path, errors) {
  if (!Array.isArray(points)) {
    errors.push({ path, message: `must be a list of breakpoints, got ${show(points)}` });
    return;
  }
  if (points.length > LANE_MOST_POINTS) {
    errors.push({ path, message: `must hold at most ${LANE_MOST_POINTS} points` });
    return;
  }
  let previous = -Infinity;
  points.forEach((point, i) => {
    const at = `${path}[${i}]`;
    const length = i === 0 ? 2 : 3;
    if (!Array.isArray(point) || point.length < 2 || point.length > 3) {
      errors.push({
        path: at,
        message: "must be [seconds, offset] for the first point, then [seconds, offset, curve]",
      });
      return;
    }
    const [time, offset, curve] = point;
    const before = errors.length;
    checkValue(LANE_TIME, time, `${at}[0]`, errors);
    if (errors.length === before) {
      if (time > previous) previous = time;
      else
        errors.push({
          path: `${at}[0]`,
          message: `times must rise, but ${time} follows ${previous}`,
        });
    }
    checkValue(LANE_OFFSET, offset, `${at}[1]`, errors);
    if (point.length !== length) {
      errors.push(
        i === 0
          ? {
              path: `${at}[2]`,
              message: "the first point has no segment before it; give [seconds, offset]",
            }
          : { path: at, message: "must be [seconds, offset, curve], naming the curve into it" },
      );
    } else if (i > 0 && !Object.hasOwn(CURVES, String(curve))) {
      errors.push({
        path: `${at}[2]`,
        message: `must be one of ${listed(CURVES)}, got ${show(curve)}`,
      });
    }
  });
}

/**
 * Pushes an error for each problem with the arrangement's lanes.
 * @param {unknown} lanes
 * @param {ValidationError[]} errors
 */
export function checkLanes(lanes, errors) {
  const path = `$.${ARRANGEMENT_KEY.lanes}`;
  if (!Array.isArray(lanes)) {
    errors.push({ path, message: `must be a list, got ${show(lanes)}` });
    return;
  }
  const seen = new Set();
  lanes.forEach((lane, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(lane)) {
      errors.push({ path: at, message: `must be an object, got ${show(lane)}` });
      return;
    }
    checkKeys(lane, (key) => LANE_FIELDS.includes(key), at, errors);
    for (const key of LANE_FIELDS) {
      if (lane[key] === undefined) errors.push({ path: `${at}.${key}`, message: MISSING });
    }
    const { macro, points } = lane;
    if (macro !== undefined) {
      if (!Object.hasOwn(MACROS, String(macro))) {
        errors.push({
          path: `${at}.macro`,
          message: `must be one of ${listed(MACROS)}, got ${show(macro)}`,
        });
      } else if (seen.has(macro)) {
        errors.push({
          path: `${at}.macro`,
          message: `a track has one lane per macro, and ${macro} has one already`,
        });
      }
      seen.add(macro);
    }
    if (points !== undefined) checkPoints(points, `${at}.points`, errors);
  });
}

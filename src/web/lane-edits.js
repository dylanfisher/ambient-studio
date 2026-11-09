// The macro lanes' edits (decision 0065), with no DOM, in the manner of `timeline-edits.js`:
// each takes an arrangement and returns a new one, leaving the one given as it was. A lane is
// made by its first point and goes with its last, and lanes are kept in the schema's order of
// macros. A typed value is kept as typed, and the validator's errors say what to fix; a step or
// a drag stops at the point's neighbors and the offset's range, since it moves the one point
// the owner moved.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { LanePoint } from "../domain/lane-schema.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { Curve } from "../engine/trajectory.js" */
import { LANE_OFFSET, laneOffsetAt, withLanePoints } from "../domain/lane-schema.js";
import { CURVES, DEFAULT_CURVE } from "../engine/trajectory.js";

/** How far a key or a step button moves a point's offset. */
export const LANE_OFFSET_STEP = 0.05;
/** How far a key or a step button moves a point's time, in track seconds. */
export const LANE_TIME_STEP = 5;
/** How far past the last point a new one goes, in track seconds. */
export const LANE_ADD_SECONDS = 30;
/** The least gap between two points that a step or a drag leaves, in seconds. */
const LEAST_GAP = 0.1;

/** @param {number} value */
const tenths = (value) => Math.round(value * 10) / 10;
/** @param {number} value */
const hundredths = (value) => Math.round(value * 100) / 100;

/**
 * The lane's breakpoints; none when the macro has no lane.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @returns {LanePoint[]}
 */
export const lanePoints = (arrangement, macro) =>
  arrangement.lanes.find((lane) => lane.macro === macro)?.points ?? [];

/**
 * Adds a point after point `after`, or after the last when null: halfway to the next one, or
 * `LANE_ADD_SECONDS` past the last, up to the track's end, at the lane's offset there so the
 * lane sounds as it did. A lane's first point is at 0 s with no change. When there is no room,
 * the arrangement comes back as it was.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @param {number | null} after
 * @param {number} length the track's, in seconds
 * @returns {{ arrangement: Arrangement, index: number | null }}
 */
export function addPoint(arrangement, macro, after, length) {
  const points = lanePoints(arrangement, macro);
  if (points.length === 0)
    return { arrangement: withLanePoints(arrangement, macro, [[0, 0]]), index: 0 };
  const index = after ?? points.length - 1;
  const [time] = /** @type {LanePoint} */ (points[index]);
  const next = points[index + 1];
  const at = tenths(next ? (time + next[0]) / 2 : Math.min(length, time + LANE_ADD_SECONDS));
  if (at <= time || (next && at >= next[0])) return { arrangement, index };
  /** @type {LanePoint} */
  const point = [at, hundredths(laneOffsetAt(points, at)), DEFAULT_CURVE];
  return {
    arrangement: withLanePoints(arrangement, macro, points.toSpliced(index + 1, 0, point)),
    index: index + 1,
  };
}

/**
 * Removes point `index`, choosing the one before it, or the new first; null once the lane is
 * gone.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @param {number} index
 * @returns {{ arrangement: Arrangement, index: number | null }}
 */
export function removePoint(arrangement, macro, index) {
  const points = lanePoints(arrangement, macro).toSpliced(index, 1);
  return {
    arrangement: withLanePoints(arrangement, macro, points),
    index: points.length === 0 ? null : Math.max(0, index - 1),
  };
}

/**
 * Sets point `index`'s time or offset from the fields, as typed.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @param {number} index
 * @param {{ time?: number, offset?: number }} values
 * @returns {Arrangement}
 */
export function setPoint(arrangement, macro, index, { time, offset }) {
  const points = lanePoints(arrangement, macro).map((point, i) => {
    if (i !== index) return point;
    const [t, v, ...curve] = point;
    return /** @type {LanePoint} */ ([time ?? t, offset ?? v, ...curve]);
  });
  return withLanePoints(arrangement, macro, points);
}

/**
 * Moves point `index` by `seconds` and `offset`, as a step or a drag does: its time stays
 * between its neighbors and at or after 0, its offset in `LANE_OFFSET`'s range.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @param {number} index
 * @param {{ seconds: number, offset: number }} by
 * @returns {Arrangement}
 */
export function movePoint(arrangement, macro, index, by) {
  const points = lanePoints(arrangement, macro);
  const point = /** @type {LanePoint} */ (points[index]);
  const earliest = index === 0 ? 0 : /** @type {LanePoint} */ (points[index - 1])[0] + LEAST_GAP;
  const next = points[index + 1];
  const latest = next ? next[0] - LEAST_GAP : Number.POSITIVE_INFINITY;
  const time = tenths(Math.min(latest, Math.max(earliest, point[0] + by.seconds)));
  const offset = hundredths(
    Math.min(LANE_OFFSET.max, Math.max(LANE_OFFSET.min, point[1] + by.offset)),
  );
  return setPoint(arrangement, macro, index, { time, offset });
}

/**
 * Gives point `index` the next of 0007's curves into it, in their order. The first point has no
 * segment before it, so it stays as it is.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @param {number} index
 * @returns {Arrangement}
 */
export function nextPointCurve(arrangement, macro, index) {
  if (index === 0) return arrangement;
  const names = /** @type {Curve[]} */ (Object.keys(CURVES));
  const points = lanePoints(arrangement, macro).map((point, i) => {
    if (i !== index) return point;
    const [time, offset, curve] = point;
    const at = names.indexOf(/** @type {Curve} */ (curve));
    return /** @type {LanePoint} */ ([time, offset, names[(at + 1) % names.length]]);
  });
  return withLanePoints(arrangement, macro, points);
}

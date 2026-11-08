// A track's macro lanes (decision 0065): at most one lane per macro across the track, its
// breakpoints in track seconds with 0007's curves, each an offset added to every section's own
// macro there. Stored in the arrangement's `lanes`, checked by `validateArrangement`.
/** @import { NumberDescriptor } from "../engine/descriptor.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { Curve, Trajectory } from "../engine/trajectory.js" */
import { number } from "../engine/descriptor.js";
import { LANE_POINTS } from "../engine/macro-lane.js";
import { POINTS_KEY, valueAt } from "../engine/trajectory.js";
import { MAX_TRACK_SECONDS } from "./arrangement-schema.js";

/**
 * A breakpoint's time on the track. One past the track's end is kept and never reached, as a
 * trajectory's past its genome's duration is (0007).
 * @type {NumberDescriptor}
 */
export const LANE_TIME = number({
  min: 0,
  max: MAX_TRACK_SECONDS,
  default: 0,
  unit: "s",
  description: "where on the track the breakpoint is",
});

/**
 * A breakpoint's offset: added to the section's own macro, then clamped to 0–1.
 * @type {NumberDescriptor}
 */
export const LANE_OFFSET = number({
  min: -0.5,
  max: 0.5,
  default: 0,
  unit: "",
  description: "added to each section's own macro; 0 is no change",
});

/**
 * The most breakpoints a lane holds: two fewer than a laned macro may, so a section's two ends
 * fit beside every breakpoint of the lane inside it.
 */
export const LANE_MOST_POINTS = LANE_POINTS - 2;

/** A lane's keys, in the order a stored one lists them: its points are a trajectory's. */
export const LANE_FIELDS = Object.freeze(["macro", POINTS_KEY]);

/**
 * A breakpoint: track seconds and an offset. Every one after the first names the curve of the
 * segment that arrives at it, written out; the first names none.
 * @typedef {[number, number] | [number, number, Curve]} LanePoint
 */

/**
 * @typedef {object} Lane
 * @property {MacroName} macro
 * @property {LanePoint[]} points times rising; none changes nothing
 */

/**
 * The lane's offset at a track time: exact at each breakpoint, along each arriving curve
 * between them, and held before the first and after the last, as a trajectory is (0007).
 * @param {readonly LanePoint[]} points at least one
 * @param {number} time track seconds
 */
export const laneOffsetAt = (points, time) =>
  valueAt(/** @type {Trajectory} */ (/** @type {unknown} */ ({ points })), time, LANE_OFFSET.scale);

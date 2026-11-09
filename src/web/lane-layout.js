// The macro lanes' layout (decision 0065), with no DOM, beside `timeline-layout.js`: each point
// placed across by its track time and down by its offset, +0.5 at the top, the lane's line as
// `applyLanes` reads it, and what a lane and a point say in words. `lane-panel.js` draws it.
/** @import { LanePoint } from "../domain/lane-schema.js" */
/** @import { Curve } from "../engine/trajectory.js" */
import { LANE_OFFSET, laneOffsetAt } from "../domain/lane-schema.js";
import { macroWords } from "../domain/macro-words.js";
import { LANE_POINTS } from "../engine/macro-lane.js";
import { clockTime } from "./excerpt-player.js";
import { curveWords } from "./transition-text.js";

/** Percents are rounded to this many places, so a layout compares equal across browsers. */
const PLACES = 1e6;
/** Steps the line takes across each segment, so a curve shows as one. */
const LINE_STEPS = 8;

/** @param {number} share */
const percent = (share) => Math.round(share * 100 * PLACES) / PLACES;

/**
 * How far down its lane an offset sits, in percent: the top is `LANE_OFFSET.max`.
 * @param {number} offset
 */
export const offsetTop = (offset) =>
  percent((LANE_OFFSET.max - offset) / (LANE_OFFSET.max - LANE_OFFSET.min));

/**
 * Where each point sits, in percent of the lane's width and height, and the lane's line as an
 * SVG polyline's points on a 100 × 100 box, from the track's start to its end.
 * @param {LanePoint[]} points
 * @param {number} length the track's, in seconds
 * @returns {{ dots: { left: number, top: number }[], line: string }}
 */
export function laneLayout(points, length) {
  /** @param {number} time */
  const across = (time) => (length > 0 ? Math.min(100, percent(time / length)) : 0);
  const dots = points.map(([time, offset]) => ({ left: across(time), top: offsetTop(offset) }));
  if (points.length === 0) return { dots, line: `0,${offsetTop(0)} 100,${offsetTop(0)}` };
  const times = [0];
  points.forEach(([time], i) => {
    const before = i === 0 ? time : /** @type {LanePoint} */ (points[i - 1])[0];
    for (let step = 1; step <= LINE_STEPS; step++) {
      times.push(i === 0 ? time : before + ((time - before) * step) / LINE_STEPS);
    }
  });
  times.push(length);
  const line = [...new Set(times.filter((time) => time <= length))]
    .map((time) => `${across(time)},${offsetTop(laneOffsetAt(points, time))}`)
    .join(" ");
  return { dots, line };
}

/**
 * The offset a drag of `pixels` down a lane `height` pixels tall moves, to a hundredth: the
 * lane's whole height is the offset's whole range.
 * @param {number} pixels
 * @param {number} height
 */
export function dragOffset(pixels, height) {
  if (!(height > 0)) return 0;
  const moved = -(pixels / height) * (LANE_OFFSET.max - LANE_OFFSET.min);
  return Math.round(moved * 100) / 100 + 0;
}

/** @param {string} macro */
const named = (macro) => `${macro[0]?.toUpperCase()}${macro.slice(1)}`;

/**
 * A lane's line under its name.
 * @param {string} macro
 * @param {LanePoint[]} points
 */
export function laneText(macro, points) {
  if (points.length === 0) {
    return `${named(macro)}: no points, so each section plays its own ${macro}.`;
  }
  const offsets = points.map(([, offset]) => offset);
  const count = points.length === 1 ? "1 point" : `${points.length} points`;
  return `${named(macro)}: ${count}, from ${signed(Math.min(...offsets))} to ${signed(Math.max(...offsets))}.`;
}

/** An offset at most this far from 0 is "by a little"; one at least `MUCH` "by a lot". */
const LITTLE = 0.15;
const MUCH = 0.35;

/**
 * A lane in words (0087): each point's time on the track and which way it moves the macro, by a
 * little or a lot, with no offsets.
 * @param {string} macro
 * @param {readonly LanePoint[]} points
 */
export function laneWords(macro, points) {
  if (points.length === 0) return `${named(macro)}: each section plays its own ${macro}.`;
  const { more, less } = macroWords(macro);
  const said = points.map(([time, offset]) => {
    const at = clockTime(time);
    if (offset === 0) return `as each section has it at ${at}`;
    const size = Math.abs(offset);
    const by = size <= LITTLE ? " by a little" : size >= MUCH ? " by a lot" : "";
    return `${offset > 0 ? more : less}${by} at ${at}`;
  });
  return `${named(macro)}: ${said.join(", ")}.`;
}

/** @param {number} offset */
const signed = (offset) => `${offset > 0 ? "+" : ""}${offset.toFixed(2)}`;

/**
 * What the chosen point does, in words.
 * @param {string} macro
 * @param {LanePoint[]} points
 * @param {number} index
 */
export function pointText(macro, points, index) {
  const [time, offset, curve] = /** @type {LanePoint} */ (points[index]);
  const words = macroWords(macro);
  const way = offset > 0 ? words.more : offset < 0 ? words.less : "no change";
  const into = curve === undefined ? "" : ` Into it: ${curveWords(/** @type {Curve} */ (curve))}.`;
  return `Point ${index + 1} of ${points.length}, at ${clockTime(time)} of the track: ${signed(offset)}, ${way}.${into}`;
}

/**
 * What the page says when lanes thin a section's own macro motion, or null when none do.
 * @param {readonly string[][]} sections each section's thinned macros, in order
 * @returns {string | null}
 */
export function thinningText(sections) {
  const lines = sections.flatMap((macros, i) =>
    macros.length === 0 ? [] : [`section ${i + 1}'s own ${macros.join(" and ")}`],
  );
  if (lines.length === 0) return null;
  return `The lanes hold so many points that they thin ${lines.join(", ")}: its own breakpoints there are spread over the room a trajectory's ${LANE_POINTS} points leave. Fewer lane points inside the section keep them all.`;
}

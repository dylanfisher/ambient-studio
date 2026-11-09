// A candidate's place on each of its brief's directions, in words (decision 0085): where its
// excerpt sits on the brief's own scale (0056), 0 at the brief's least so far and 1 at its most,
// read in seven bands. The number itself is behind the numbers toggle.
import { AXIS_SOURCE } from "./attachment-kind.js";
import { axisName, nearText } from "./axis-words.js";

/** Up to this far from an end is "close to" it; up to `leaning`, "leaning toward" it. */
const POSITION_BANDS = Object.freeze({ close: 0.2, leaning: 0.4 });

/** What a position says when the excerpt has none yet on a direction. */
export const NOT_PLACED = "not placed yet";

/** @typedef {{ near: string | null, far: string }} DirectionEnds */

/**
 * @param {DirectionEnds} direction
 * @param {number | undefined} position on the brief's scale; undefined when not placed
 * @returns {string}
 */
export function positionWords({ near, far }, position) {
  if (position === undefined) return NOT_PLACED;
  const low = nearText(near);
  const high = `“${far}”`;
  const beyond = "further than any excerpt of this brief so far";
  const { close, leaning } = POSITION_BANDS;
  if (position < 0) return `past ${low}, ${beyond}`;
  if (position > 1) return `past ${high}, ${beyond}`;
  if (position <= close) return `close to ${low}`;
  if (position <= leaning) return `leaning toward ${low}`;
  if (1 - position <= close) return `close to ${high}`;
  if (1 - position <= leaning) return `leaning toward ${high}`;
  return `midway between ${low} and ${high}`;
}

/**
 * The card's line, one clause per direction, or "" when the brief has no direction or the card
 * no excerpt.
 * @param {readonly (DirectionEnds & { positions: Record<number, number> })[]} directions as the
 *   steering route gives them
 * @param {number | null} renderId the card's excerpt
 * @returns {string}
 */
export function positionsWords(directions, renderId) {
  if (directions.length === 0 || renderId === null) return "";
  const clauses = directions.map(
    (direction) =>
      `on ${axisName({ source: AXIS_SOURCE.direction, ...direction })}, ${positionWords(direction, direction.positions[renderId])}`,
  );
  const line = clauses.join("; ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

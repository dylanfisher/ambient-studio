// How the brief and session pages word a brief's directions (decision 0056): a direction's two
// ends, a card's position on each, where a card's slider starts, and the brief page's limit.
// No DOM and no request here.
import { MAX_DIRECTIONS } from "../domain/attachment-kind.js";

/** A slider moves in twentieths of the brief's spread. */
export const SLIDER_STEP = 0.05;

/**
 * @param {{ near: string | null, far: string }} direction
 * @returns {string}
 */
export const directionText = ({ near, far }) =>
  `${near === null ? "this brief's description" : `“${near}”`} to “${far}”`;

/**
 * The card's line of positions, one per direction, or "" when the brief has no direction or the
 * card no excerpt.
 * @param {readonly { near: string | null, far: string, positions: Record<number, number> }[]} directions
 *   as the steering route gives them
 * @param {number | null} renderId the card's excerpt
 * @returns {string}
 */
export function positionsLine(directions, renderId) {
  if (directions.length === 0 || renderId === null) return "";
  const parts = directions.map((direction) => {
    const position = direction.positions[renderId];
    const where = position === undefined ? "not placed yet" : position.toFixed(2);
    return `${directionText(direction)} ${where}`;
  });
  return `Where it sits, from 0 (this brief's least) to 1 (its most): ${parts.join("; ")}.`;
}

/**
 * Where a card's slider starts: its position, held between 0 and 1 and rounded to a step, or the
 * middle when it has none.
 * @param {number | undefined} position
 * @returns {number}
 */
export function sliderStart(position) {
  if (position === undefined) return 0.5;
  const held = Math.min(1, Math.max(0, position));
  return Number((Math.round(held / SLIDER_STEP) * SLIDER_STEP).toFixed(2));
}

/**
 * Whether a card's sliders hold choices not yet sent: a slider moved while it is on, or a region
 * ticked. A moved slider turned off since can't be sent, so it doesn't hold the card.
 * @param {Iterable<{ moved: boolean, disabled: boolean }>} sliders
 * @param {Iterable<{ checked: boolean }>} boxes
 */
export const slidersUnsent = (sliders, boxes) =>
  [...sliders].some(({ moved, disabled }) => moved && !disabled) ||
  [...boxes].some(({ checked }) => checked);

/**
 * The line under the brief page's directions.
 * @param {number} count how many the brief holds
 * @returns {string}
 */
export function directionHelp(count) {
  const limit =
    count >= MAX_DIRECTIONS
      ? `This brief holds ${MAX_DIRECTIONS}, the most it takes. Remove one to add another.`
      : `A brief takes up to ${MAX_DIRECTIONS}.`;
  return `${limit} Adding or removing one doesn't save a new version of the brief.`;
}

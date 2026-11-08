// The map page's grid (decision 0057), with no DOM: the table's rows from the archive route's
// cells, the cell an arrow key moves to, each cell's words, and the excerpt a cell plays. The
// first axis runs left to right and the second bottom to top, low to high; a third picks the
// layer the table shows.
/** @import { AxisSource } from "../domain/axis-words.js" */
import { axisName } from "../domain/axis-words.js";

/**
 * A filled cell as the archive route gives it.
 * @typedef {object} MapCell
 * @property {number[]} index
 * @property {number} count
 * @property {number} candidateId the elite's
 * @property {number} renderId
 * @property {string} url its excerpt's
 * @property {string | null} intent its own, or its nearest parent's when `ownIntent` is false
 * @property {boolean} ownIntent
 * @property {number | null} score its search score, null with no taste model
 * @property {number} misses
 */

/** @param {readonly number[]} index */
export const cellKey = (index) => index.join(",");

/**
 * The table's rows for one layer: the second axis's bins from the high end down, each with a
 * place per bin of the first axis, and the filled cell there or null.
 * @param {{ shape: readonly number[], cells: readonly MapCell[] }} map
 * @param {number} layer the third axis's bin; ignored with two axes
 * @returns {{ bin: number, cells: { index: number[], cell: MapCell | null }[] }[]}
 */
export function mapRows({ shape, cells }, layer) {
  const byKey = new Map(cells.map((each) => [cellKey(each.index), each]));
  const [columns = 0, rows = 0] = shape;
  return Array.from({ length: rows }, (_, r) => {
    const bin = rows - 1 - r;
    return {
      bin,
      cells: Array.from({ length: columns }, (_, column) => {
        const index = shape.length === 3 ? [column, bin, layer] : [column, bin];
        return { index, cell: byKey.get(cellKey(index)) ?? null };
      }),
    };
  });
}

/** Each arrow key's axis and step: across the first axis, up and down the second. */
const ARROWS = Object.freeze({
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowDown: [1, -1],
  ArrowUp: [1, 1],
});

/**
 * The cell an arrow key moves to from `index`, one step, held at the map's edge; null for any
 * other key.
 * @param {readonly number[]} index
 * @param {string} key a `KeyboardEvent.key`
 * @param {readonly number[]} shape
 * @returns {number[] | null}
 */
export function arrowMove(index, key, shape) {
  const move = ARROWS[/** @type {keyof typeof ARROWS} */ (key)];
  if (move === undefined) return null;
  const [axis = 0, step = 0] = move;
  const bin = Math.min(Number(shape[axis]) - 1, Math.max(0, Number(index[axis]) + step));
  return index.with(axis, bin);
}

/** @param {number} n @param {string} word */
const counted = (n, word) => `${n} ${word}${n === 1 ? "" : "es"}`;

/**
 * A cell button's text and title.
 * @param {MapCell | null} cell
 * @param {boolean} model whether the brief has a taste model, which scores each elite
 * @returns {{ text: string, title: string }}
 */
export function cellText(cell, model) {
  if (cell === null) {
    return {
      text: "",
      title: "Empty: no candidate lands here yet. Filling the map aims at cells like this one.",
    };
  }
  const { said, rated, about } = described(cell, model);
  return {
    text: `${cell.ownIntent ? "" : "from: "}${said} · ${rated}`,
    title: `Plays ${about}. Opens it below, with explore, nudge and keep as sketch.`,
  };
}

/**
 * A filled cell's intent, its short score, and a clause on what it holds.
 * @param {MapCell} cell
 * @param {boolean} model
 */
function described({ intent, ownIntent, score, misses, count }, model) {
  const said = intent ?? "no intent given";
  const scored = model && score !== null;
  const which = count === 1 ? "the candidate here" : `the best of the ${count} candidates here`;
  const meant = ownIntent ? `“${said}”` : `a nudge of one meant as “${said}”`;
  const how = scored
    ? `search score ${score.toFixed(2)} by your taste model`
    : `missing ${misses} of the brief's ranges`;
  return {
    said,
    rated: scored ? score.toFixed(2) : counted(misses, "miss"),
    about: `${which}: ${meant}, ${how}`,
  };
}

/**
 * The open cell's line: what it holds, as its button's title says.
 * @param {MapCell} cell
 * @param {boolean} model
 * @returns {string}
 */
export function openText(cell, model) {
  const { about } = described(cell, model);
  return `${about.charAt(0).toUpperCase()}${about.slice(1)}.`;
}

/**
 * The excerpt a cell plays: its elite's.
 * @param {MapCell} cell
 */
export const cellAudio = (cell) => cell.url;

/**
 * @param {{ filled: number, total: number, placed: number, unplaced: number }} map
 * @returns {string}
 */
export function coverageText({ filled, total, placed, unplaced }) {
  const share = total === 0 ? 0 : Math.round((filled / total) * 100);
  const left = unplaced === 0 ? "" : `; ${unplaced} more can't be placed yet`;
  return `${filled} of ${total} cells filled (${share}%), from ${placed} candidates${left}.`;
}

/** @param {number} value an end, written to about four figures */
export const endText = (value) => String(Number(value.toPrecision(4)));

/**
 * An axis's caption: its name and ends, or why it can't be read.
 * @param {AxisSource & { low: number | null, high: number | null, reason: string | null }} axis
 * @returns {string}
 */
export function axisLine(axis) {
  const name = axisName(axis);
  if (axis.reason !== null || axis.low === null || axis.high === null) {
    return `${name}: ${axis.reason ?? "no ends yet."}`;
  }
  return `${name}, from ${endText(axis.low)} to ${endText(axis.high)}`;
}

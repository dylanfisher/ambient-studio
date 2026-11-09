// A map cell and axis in words (decision 0086): where a cell sits on each axis, in the bands a
// candidate's position is said in (0085), and how its elite compares with the other cells',
// read with place-words.js's thresholds. Written from templates, never by the model (as 0047);
// the bins, ends and scores are behind the numbers toggle.
/** @import { AxisSource } from "./axis-words.js" */
import { axisName, endWords } from "./axis-words.js";
import { PLACE_SIDE, placeOf, shareBelow } from "./place-words.js";
import { POSITION_BANDS } from "./position-words.js";

/**
 * Where bin `bin` of `bins` sits on an axis: close to an end, leaning toward it, or midway,
 * read at the bin's middle.
 * @param {AxisSource} axis
 * @param {number} bin from 0, the low end
 * @param {number} bins
 * @returns {string}
 */
export function axisPlaceWords(axis, bin, bins) {
  if (!(Number.isInteger(bin) && bin >= 0 && bin < bins)) {
    throw new Error(`there is no bin ${bin} of ${bins}`);
  }
  const place = (bin + 0.5) / bins;
  const away = Math.min(place, 1 - place);
  const { close, leaning } = POSITION_BANDS;
  if (away > leaning) return `midway on ${axisName(axis)}`;
  const end = endWords(axis, place < 0.5 ? -1 : 1);
  return away <= close ? end : `leaning toward ${end}`;
}

/**
 * A cell's place on every axis, as a sentence.
 * @param {readonly number[]} index the cell's bin on each axis
 * @param {readonly number[]} shape bins per axis
 * @param {readonly AxisSource[]} axes
 * @returns {string}
 */
export function cellPlaceWords(index, shape, axes) {
  const line = axes
    .map((axis, at) => axisPlaceWords(axis, Number(index[at]), Number(shape[at])))
    .join("; ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/**
 * An axis caption's words: its low end at `lowSide` to its high end at `highSide`.
 * @param {AxisSource} axis
 * @param {string} lowSide where the low end is drawn, as the page says it
 * @param {string} highSide
 * @returns {string}
 */
export const axisSpanWords = (axis, lowSide, highSide) =>
  `from ${endWords(axis, -1)} at ${lowSide} to ${endWords(axis, 1)} at ${highSide}`;

/**
 * A filled cell's verdict: its elite's score against the other cells' with a taste model, else
 * the brief's ranges it misses.
 * @param {{ score: number | null, misses: number }} cell
 * @param {readonly (number | null)[]} others every other filled cell's score
 * @param {boolean} model whether the brief has a taste model
 * @returns {string}
 */
export function cellVerdictWords({ score, misses }, others, model) {
  if (!model || score === null) {
    if (misses === 0) return "Inside every one of the brief's ranges.";
    return misses === 1
      ? "Misses one of the brief's ranges."
      : "Misses more than one of the brief's ranges.";
  }
  const scored = others.filter((other) => other !== null);
  if (scored.length === 0) return "The only cell on the map with a score.";
  if (scored.every((other) => other < score))
    return "The best cell on the map by your taste model.";
  const { side, degree } = placeOf(shareBelow(score, scored));
  const how =
    side === null
      ? "about the middle of"
      : `${side === PLACE_SIDE.above ? "higher" : "lower"} than ${degree} of`;
  return `Your taste model scores it ${how} the map's cells.`;
}

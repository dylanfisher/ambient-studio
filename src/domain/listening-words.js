// How much of an excerpt was played, and how far through its pairs Quick A/B is, in words
// (decision 0086), for Quick A/B and the brief's ratings list. Written from these bands, never by
// the model (as 0047); the shares and counts are behind the numbers toggle.
import { PLACE_SIDE, placeOf } from "./place-words.js";

/** At least this share played is "all of it", "most of it", "about half of it". */
const PLAYED_SHARES = Object.freeze({ all: 0.95, most: 0.7, half: 0.3 });

/**
 * @param {number} fraction of the excerpt played, from 0 to 1
 * @returns {string} a phrase, such as "played most of it"
 */
export function playedWords(fraction) {
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new Error(`there is no played share ${fraction}`);
  }
  const { all, most, half } = PLAYED_SHARES;
  if (fraction === 0) return "not played yet";
  if (fraction >= all) return "played all of it";
  if (fraction >= most) return "played most of it";
  if (fraction >= half) return "played about half of it";
  return "played a little of it";
}

/**
 * How far through its pairs the page is, from the pairs left, this one included.
 * @param {number} left
 * @param {number | null} total the pairs in all, or null when the order has no fixed end
 * @returns {string}
 */
export function pairsLeftWords(left, total) {
  if (!(Number.isInteger(left) && left >= 1 && (total === null || left <= total))) {
    throw new Error(`there are no ${left} pairs left of ${total}`);
  }
  if (left === 1) return "This is the last pair.";
  if (total === null) return "More pairs come after this one.";
  if (left === total) return "This is the first pair.";
  const { side } = placeOf((total - left) / total);
  if (side === PLACE_SIDE.above) return "Nearly done: a few pairs are left.";
  if (side === PLACE_SIDE.below) return "Most of the pairs are still to come.";
  return "About halfway through the pairs.";
}

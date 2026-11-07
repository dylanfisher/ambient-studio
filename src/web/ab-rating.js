// What an A/B rating sends to `POST …/ab-ratings` (decision 0027), for the session page's
// comparison and the Quick A/B page alike. The page shows the pair in the server's order and
// sends that order's seed back, so the stored row says which side was on the left.
/** @import { AbPair } from "./ab-view.js" */
import { OUTCOMES } from "../domain/rating-values.js";

/** @typedef {(typeof OUTCOMES)[number]} Outcome */

/** Where a side of a pair is shown on the page. */
export const SCREEN_SIDES = /** @type {const} */ (["left", "right"]);
const [LEFT] = SCREEN_SIDES;

/**
 * The outcome when the owner chose the side shown on `chosen`.
 * @param {AbPair} pair
 * @param {(typeof SCREEN_SIDES)[number]} chosen
 * @returns {"a" | "b"}
 */
export function chosenOutcome({ leftSide }, chosen) {
  if (chosen === LEFT) return leftSide;
  return leftSide === "a" ? "b" : "a";
}

/**
 * @param {AbPair} pair
 * @param {Outcome} outcome
 * @param {{ left: number, right: number }} played each side's played fraction, by where it was shown
 * @param {number} timeTakenMs
 */
export function abRatingBody({ a, b, orderSeed, leftSide }, outcome, played, timeTakenMs) {
  const [aPlayed, bPlayed] =
    leftSide === "a" ? [played.left, played.right] : [played.right, played.left];
  return {
    a,
    b,
    orderSeed,
    outcome,
    aPlayedFraction: aPlayed,
    bPlayedFraction: bPlayed,
    timeTakenMs,
  };
}

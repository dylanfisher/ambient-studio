// The session row's rank and a search point's score as plain verdicts (decision 0085): where
// each sits among the others, read with place-words.js's thresholds. The rank and the score
// themselves are behind the numbers toggle.
import { OPERATOR } from "./operator.js";
import { PLACE_SIDE, placeOf, shareBelow } from "./place-words.js";

/**
 * Where the taste model ranks the excerpt among the session's ranked excerpts (0046).
 * @param {number} rank from 1, the best
 * @param {number} total the excerpts ranked
 * @returns {string}
 */
export function rankWords(rank, total) {
  if (!(Number.isInteger(rank) && rank >= 1 && rank <= total)) {
    throw new Error(`there is no rank ${rank} of ${total}`);
  }
  if (total === 1) return "The only excerpt your taste model has ranked in this session.";
  if (rank === 1) return "Your taste model likes it best in this session.";
  if (rank === total) return "Your taste model likes it least in this session.";
  const { side, degree } = placeOf((total - rank) / (total - 1));
  if (side === null) return "Your taste model puts it in the middle of this session.";
  return `Your taste model likes it ${side === PLACE_SIDE.above ? "more than" : "less than"} ${degree} of this session.`;
}

/**
 * A search or steer point's score against the other scored points of its run on the page.
 * @param {number} score
 * @param {readonly number[]} others the run's other points' scores
 * @param {string} operator the point's, a search's (`optimize`) or a steer's
 * @returns {string}
 */
export function searchScoreWords(score, others, operator) {
  const kind = operator === OPERATOR.steer ? "steer" : "search";
  if (others.length === 0) return `The only point of this ${kind} with a score on this page.`;
  if (others.every((other) => other < score)) return `The best point this ${kind} found.`;
  const { side, degree } = placeOf(shareBelow(score, others));
  if (side === null) return `Scores about the middle of this ${kind}'s points.`;
  return `Scores ${side === PLACE_SIDE.above ? "higher than" : "lower than"} ${degree} of this ${kind}'s points.`;
}

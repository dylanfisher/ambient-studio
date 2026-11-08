// The pair picker over a session's ranking (decision 0046), for the pages that draw pairs of
// candidates: each candidate's excerpt is found in the ranking's covariance by its render id,
// and `widestPair` picks. No DOM.
/** @import { Pair, Question } from "./quick-ab-order.js" */
import { widestPair } from "../domain/widest-pair.js";

/**
 * The ranking as `GET …/candidates` sends it.
 * @typedef {{ renderIds: number[], covariance: number[][] }} PairRanking
 */

/**
 * @param {PairRanking | null} ranking null when the session isn't ranked
 * @param {readonly { id: number, excerpt: { renderId: number } | null }[]} candidates
 * @returns {Question | null} null when the session isn't ranked, so there is no question
 */
export function questionOf(ranking, candidates) {
  if (!ranking) return null;
  const byRender = new Map(ranking.renderIds.map((renderId, i) => [renderId, i]));
  /** @type {Map<number, number>} each ranked candidate's row in the covariance */
  const rows = new Map();
  for (const { id, excerpt } of candidates) {
    const row = excerpt && byRender.get(excerpt.renderId);
    if (row !== null && row !== undefined) rows.set(id, row);
  }
  return (pairs) => {
    const asked = pairs.filter(([x, y]) => rows.has(x) && rows.has(y));
    /** @param {Pair} pair @returns {[number, number]} */
    const rowsOf = ([x, y]) => [
      /** @type {number} */ (rows.get(x)),
      /** @type {number} */ (rows.get(y)),
    ];
    const widest = widestPair(ranking.covariance, asked.map(rowsOf));
    if (!widest) return null;
    return asked.find((pair) => rowsOf(pair).join() === widest.join()) ?? null;
  };
}

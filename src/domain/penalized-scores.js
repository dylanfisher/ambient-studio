// The scores a generation tells its optimizer (decision 0053). A rejected point is never
// rendered, so it has no score of its own; it is told one below every valid point, so the
// optimizer moves away from it without the penalty swamping the valid scores' spread.

/** What each point is told when no point of the generation is valid. */
export const NO_VALID_SCORE = -1;

/**
 * Each score as given, and for each null (a rejected point) the generation's worst valid score
 * less the valid scores' population standard deviation, or `NO_VALID_SCORE` when none is valid.
 * @param {readonly (number | null)[]} scores in the order the points were asked
 * @returns {number[]}
 */
export function penalizedScores(scores) {
  const valid = scores.filter((score) => score !== null);
  if (!valid.every(Number.isFinite)) throw new Error(`a search score must be finite: ${valid}`);
  if (valid.length === 0) return scores.map(() => NO_VALID_SCORE);
  const mean = valid.reduce((sum, score) => sum + score, 0) / valid.length;
  const variance = valid.reduce((sum, score) => sum + (score - mean) ** 2, 0) / valid.length;
  const penalty = Math.min(...valid) - Math.sqrt(variance);
  return scores.map((score) => score ?? penalty);
}

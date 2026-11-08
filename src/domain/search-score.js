// The one objective a search maximizes (decision 0053): the preference model's posterior mean
// less κ standard deviations. A lower bound keeps the search where the model has evidence,
// rather than chasing a high mean the model is unsure of. A steer adds terms (0056): each a
// value and its weight against the model score's 1, so with no terms the score is the bound.

/** κ, the standard deviations taken off the mean. */
export const SEARCH_KAPPA = 1;

/**
 * @typedef {object} ScoreTerm
 * @property {number} value
 * @property {number} weight
 */

/**
 * The weighted sum of the terms, the whole score when the brief has no taste model.
 * @param {readonly ScoreTerm[]} terms
 * @returns {number}
 */
export function termsScore(terms) {
  let sum = 0;
  for (const { value, weight } of terms) {
    if (!Number.isFinite(value) || !Number.isFinite(weight)) {
      throw new Error(`a score term must be finite, got ${value} at weight ${weight}`);
    }
    sum += weight * value;
  }
  return sum;
}

/**
 * @param {number} mean the model's posterior mean score for one excerpt
 * @param {number} variance its posterior variance
 * @param {readonly ScoreTerm[]} [terms] a steer's; none for a plain search
 * @returns {number}
 */
export function searchScore(mean, variance, terms = []) {
  if (!Number.isFinite(mean) || !Number.isFinite(variance) || variance < 0) {
    throw new Error(
      `a search score needs a finite mean and variance from 0, got ${mean}, ${variance}`,
    );
  }
  const bound = mean - SEARCH_KAPPA * Math.sqrt(variance);
  return terms.length === 0 ? bound : bound + termsScore(terms);
}

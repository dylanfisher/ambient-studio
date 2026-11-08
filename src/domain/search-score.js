// The one objective a search maximizes (decision 0053): the preference model's posterior mean
// less κ standard deviations. A lower bound keeps the search where the model has evidence,
// rather than chasing a high mean the model is unsure of.

/** κ, the standard deviations taken off the mean. */
export const SEARCH_KAPPA = 1;

/**
 * @param {number} mean the model's posterior mean score for one excerpt
 * @param {number} variance its posterior variance
 * @returns {number}
 */
export function searchScore(mean, variance) {
  if (!Number.isFinite(mean) || !Number.isFinite(variance) || variance < 0) {
    throw new Error(
      `a search score needs a finite mean and variance from 0, got ${mean}, ${variance}`,
    );
  }
  return mean - SEARCH_KAPPA * Math.sqrt(variance);
}

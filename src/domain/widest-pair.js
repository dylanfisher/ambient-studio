// The pair picker (decision 0046): of the pairs offered, the one the taste model is least sure
// how to order, by the posterior variance of the two scores' difference. Two items that are
// each uncertain but move together make a pair whose answer teaches little, so the covariance
// is read, not the variances alone.

/**
 * The variance of item a's score less item b's.
 * @param {readonly (readonly number[])[]} covariance the items' full posterior covariance
 * @param {number} a
 * @param {number} b
 */
export function differenceVariance(covariance, a, b) {
  /** @param {number} i @param {number} j */
  const at = (i, j) => {
    const value = covariance[i]?.[j];
    if (value === undefined) {
      throw new Error(`the covariance has no entry for items ${i} and ${j}`);
    }
    return value;
  };
  return at(a, a) + at(b, b) - 2 * at(a, b);
}

/**
 * @param {readonly (readonly number[])[]} covariance
 * @param {readonly (readonly [number, number])[]} pairs the pairs allowed, by item index
 * @returns {[number, number] | null} the widest, the first offered on a tie; null when none
 *   is offered or none has any variance, since then the model can't tell them apart
 */
export function widestPair(covariance, pairs) {
  /** @type {[number, number] | null} */
  let best = null;
  let widest = 0;
  for (const [a, b] of pairs) {
    const variance = differenceVariance(covariance, a, b);
    if (variance > widest) {
      best = [a, b];
      widest = variance;
    }
  }
  return best;
}

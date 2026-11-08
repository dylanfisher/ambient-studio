/**
 * The mean of `vectors`, scaled to length 1: a region's embedding from its windows' (decision
 * 0051), as 0042 makes an excerpt's from its 10 s windows.
 * @param {readonly Float32Array[]} vectors one or more of one length
 * @returns {Float32Array}
 */
export function unitMean(vectors) {
  const [first] = vectors;
  if (first === undefined) throw new Error("a unit mean needs at least one vector");
  const sum = new Float64Array(first.length);
  for (const vector of vectors) {
    if (vector.length !== first.length) {
      throw new Error(`a vector of ${vector.length} floats can't join ${first.length} floats`);
    }
    for (let i = 0; i < sum.length; i++) {
      sum[i] = /** @type {number} */ (sum[i]) + /** @type {number} */ (vector[i]);
    }
  }
  const length = Math.hypot(...sum);
  if (length === 0) throw new Error("the vectors' mean is zero, which has no direction");
  return Float32Array.from(sum, (value) => value / length);
}

/**
 * The cosine similarity between the mean of `vectors` and `target`: how near a genome's rated
 * excerpts, taken together, sit to a text in CLAP's space (decision 0024's 4h amendment). The
 * mean of unit vectors is shorter the more they disagree, and the cosine divides that length
 * out, so two excerpts far apart count as their midpoint.
 * @param {readonly Float32Array[]} vectors one or more, each as long as `target`
 * @param {Float32Array} target
 * @returns {number} from −1 to 1
 */
export function meanSimilarity(vectors, target) {
  if (vectors.length === 0) throw new Error("mean similarity needs at least one vector");
  const mean = new Float64Array(target.length);
  for (const vector of vectors) {
    if (vector.length !== target.length) {
      throw new Error(
        `a vector of ${vector.length} floats can't be compared with ${target.length}`,
      );
    }
    for (let i = 0; i < mean.length; i++) {
      mean[i] = /** @type {number} */ (mean[i]) + /** @type {number} */ (vector[i]);
    }
  }
  let dot = 0;
  let meanSquare = 0;
  let targetSquare = 0;
  for (let i = 0; i < mean.length; i++) {
    const m = /** @type {number} */ (mean[i]);
    const t = /** @type {number} */ (target[i]);
    dot += m * t;
    meanSquare += m * m;
    targetSquare += t * t;
  }
  if (meanSquare === 0 || targetSquare === 0) {
    throw new Error("mean similarity is undefined for a zero vector");
  }
  return dot / Math.sqrt(meanSquare * targetSquare);
}

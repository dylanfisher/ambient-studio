// A direction in CLAP's space between two ends the owner typed, "dry" to "underwater" (decision
// 0056), and where a sound sits along it. Pure, over stored embeddings, so the session page's
// sliders and phase 6's sections and automation read the same numbers.

/**
 * The unit vector from `near` to `far`: their difference scaled to length 1.
 * @param {ArrayLike<number>} near
 * @param {ArrayLike<number>} far as long as `near`
 * @returns {Float32Array}
 */
export function directionVector(near, far) {
  if (near.length !== far.length) {
    throw new Error(
      `a direction's ends must be one length: ${near.length} floats and ${far.length} floats`,
    );
  }
  const difference = Float64Array.from(far, (value, i) => value - /** @type {number} */ (near[i]));
  const length = Math.hypot(...difference);
  if (length === 0)
    throw new Error("a direction's two ends embed the same, so it has no way to point");
  return Float32Array.from(difference, (value) => value / length);
}

/**
 * How far along `direction` the embedding sits: their dot product.
 * @param {ArrayLike<number>} embedding
 * @param {ArrayLike<number>} direction from `directionVector`
 * @returns {number}
 */
export function projection(embedding, direction) {
  if (embedding.length !== direction.length) {
    throw new Error(
      `an embedding of ${embedding.length} floats can't be projected on a direction of ${direction.length} floats`,
    );
  }
  let dot = 0;
  for (let i = 0; i < direction.length; i++) {
    dot += /** @type {number} */ (embedding[i]) * /** @type {number} */ (direction[i]);
  }
  return dot;
}

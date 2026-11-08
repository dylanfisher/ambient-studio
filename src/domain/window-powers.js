/**
 * The mean power of windows over a sub-block power series: window j spans sub-blocks
 * `[j * hop, j * hop + size)`, and only complete windows are returned. Gating blocks, momentary
 * and short-term loudness are all this with different sizes and hops.
 * @param {Float64Array} power from `kWeightedPower`
 * @param {number} size window length in sub-blocks
 * @param {number} hop step between window starts in sub-blocks
 * @returns {Float64Array}
 */
export function windowPowers(power, size, hop) {
  return createWindowPowers(size, hop).push(power);
}

/**
 * `windowPowers` over a power series read in pieces of any length, with the same bits (0060):
 * it keeps the last `size` sub-block powers and sums each window in the same order.
 * @param {number} size window length in sub-blocks
 * @param {number} hop step between window starts in sub-blocks
 * @returns {{ push: (power: Float64Array) => Float64Array }} `push` takes the next sub-block
 *   powers and returns the mean power of each window they complete
 */
export function createWindowPowers(size, hop) {
  const recent = new Float64Array(size);
  // Sub-blocks pushed so far.
  let count = 0;
  /** @param {number} total sub-blocks @returns {number} the windows they complete */
  const completed = (total) => (total < size ? 0 : Math.floor((total - size) / hop) + 1);
  return {
    push(power) {
      const out = new Float64Array(completed(count + power.length) - completed(count));
      let j = 0;
      for (const value of power) {
        recent[count % size] = value;
        count++;
        if (count < size || (count - size) % hop !== 0) continue;
        let sum = 0;
        for (let k = count - size; k < count; k++) sum += recent[k % size] ?? 0;
        out[j++] = sum / size;
      }
      return out;
    },
  };
}

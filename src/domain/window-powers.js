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
  const count = power.length < size ? 0 : Math.floor((power.length - size) / hop) + 1;
  const out = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    let sum = 0;
    for (let k = j * hop, stop = k + size; k < stop; k++) sum += power[k] ?? 0;
    out[j] = sum / size;
  }
  return out;
}

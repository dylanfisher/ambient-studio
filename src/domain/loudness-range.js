const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -20;
const LOW_PERCENTILE = 0.1;
const HIGH_PERCENTILE = 0.95;

/**
 * EBU Tech 3342 loudness range: the spread between the 10th and 95th percentiles of the
 * short-term series, after the -70 LUFS absolute gate and a relative gate 20 LU under the mean
 * power of what passed it.
 * @param {Float64Array} shortTerm LUFS, as `shortTermLoudness` returns it
 * @returns {number | null} LU; null when no window passes the absolute gate
 */
export function loudnessRange(shortTerm) {
  const audible = shortTerm.filter((lufs) => lufs > ABSOLUTE_GATE_LUFS);
  if (audible.length === 0) return null;
  // The mean is taken in power, as the integrated gate is (BS.1770 equation 2).
  const meanPower = audible.reduce((a, lufs) => a + 10 ** (lufs / 10), 0) / audible.length;
  const gate = 10 * Math.log10(meanPower) + RELATIVE_GATE_LU;
  const kept = audible.filter((lufs) => lufs > gate).sort();
  return percentile(kept, HIGH_PERCENTILE) - percentile(kept, LOW_PERCENTILE);
}

/**
 * Nearest-rank percentile of sorted values.
 * @param {Float64Array} sorted
 * @param {number} p in (0, 1]
 */
function percentile(sorted, p) {
  return /** @type {number} */ (sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]);
}

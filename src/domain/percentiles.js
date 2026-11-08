// The percentiles an evaluation reports for latency and time to first token (decision 0030).

/**
 * @typedef {object} Percentiles
 * @property {number} count how many values
 * @property {number} p50
 * @property {number} p90
 * @property {number} p95
 * @property {number} max
 */

/**
 * Nearest rank: the p-th percentile is the smallest value with at least p% of the values at or
 * under it, so every reported number is one that was measured.
 * @param {readonly number[]} values
 * @returns {Percentiles}
 */
export function percentiles(values) {
  if (values.length === 0) throw new Error("percentiles of no values");
  if (!values.every(Number.isFinite)) {
    throw new Error(`percentiles take finite numbers, got ${values.join(", ")}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (/** @type {number} */ p) => nearestRank(sorted, p);
  return {
    count: sorted.length,
    p50: rank(50),
    p90: rank(90),
    p95: rank(95),
    max: /** @type {number} */ (sorted.at(-1)),
  };
}

/**
 * The p-th percentile of values sorted ascending, by nearest rank.
 * @param {readonly number[]} sorted at least one
 * @param {number} p above 0, at most 100
 * @returns {number}
 */
export const nearestRank = (sorted, p) =>
  /** @type {number} */ (sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);

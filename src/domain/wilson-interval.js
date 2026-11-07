// The Wilson score interval for a share of successes (decision 0030). Unlike the normal
// approximation it stays inside 0 to 1 and keeps its width near 0% and 100%, where the
// evaluation's valid rates sit.

/** The normal quantile for a two-sided 95% interval. */
const Z_95 = 1.959964;

/**
 * @param {number} successes a whole number from 0 to `trials`
 * @param {number} trials a whole number above 0
 * @returns {{ low: number, high: number }} the 95% interval, as shares from 0 to 1
 */
export function wilsonInterval(successes, trials) {
  if (
    !Number.isInteger(trials) ||
    trials < 1 ||
    !Number.isInteger(successes) ||
    successes < 0 ||
    successes > trials
  ) {
    throw new Error(
      `successes must be a whole number from 0 to trials, and trials at least 1; got ${successes} of ${trials}`,
    );
  }
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const scale = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / scale;
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / scale;
  // Rounding can put an end a hair past 0 or 1 when every trial or none succeeds.
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

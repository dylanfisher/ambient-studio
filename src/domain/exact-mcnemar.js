// The exact one-sided McNemar test (decision 0040) on paired yes/no outcomes: of the pairs where
// the two arms differ, `treatmentOnly` went the treatment's way and `controlOnly` the control's.
// Under no difference each discordant pair is a fair coin, so p is the chance of at least
// `treatmentOnly` heads in `treatmentOnly + controlOnly` tosses. The binomial sum is taken in
// whole numbers, since 2^n passes a double's exact range past n = 53.

/** Above this many bits both sums are shifted down before the division, so neither is Infinity. */
const DOUBLE_BITS = 1000;

/**
 * @param {number} treatmentOnly whole number from 0
 * @param {number} controlOnly whole number from 0
 * @returns {number} the one-sided p, 1 when no pair differs
 */
export function exactMcNemar(treatmentOnly, controlOnly) {
  for (const count of [treatmentOnly, controlOnly]) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `the discordant counts must be whole numbers from 0, got ${treatmentOnly} and ${controlOnly}`,
      );
    }
  }
  const n = BigInt(treatmentOnly + controlOnly);
  const b = BigInt(treatmentOnly);
  let tail = 0n;
  // term is C(n, k), stepped from C(n, 0).
  let term = 1n;
  for (let k = 0n; k <= n; k++) {
    if (k >= b) tail += term;
    term = (term * (n - k)) / (k + 1n);
  }
  const shift = n > BigInt(DOUBLE_BITS) ? n - BigInt(DOUBLE_BITS) : 0n;
  return Number(tail >> shift) / Number((1n << n) >> shift);
}

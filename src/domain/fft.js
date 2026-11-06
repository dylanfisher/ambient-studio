/**
 * In-place radix-2 FFT of `re` and `im`, whose length is a power of 2.
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [/** @type {number} */ (re[j]), /** @type {number} */ (re[i])];
      [im[i], im[j]] = [/** @type {number} */ (im[j]), /** @type {number} */ (im[i])];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const c = Math.cos(step * k);
        const s = Math.sin(step * k);
        const br = /** @type {number} */ (re[b]);
        const bi = /** @type {number} */ (im[b]);
        const tr = br * c - bi * s;
        const ti = br * s + bi * c;
        re[b] = /** @type {number} */ (re[a]) - tr;
        im[b] = /** @type {number} */ (im[a]) - ti;
        re[a] = /** @type {number} */ (re[a]) + tr;
        im[a] = /** @type {number} */ (im[a]) + ti;
      }
    }
  }
}

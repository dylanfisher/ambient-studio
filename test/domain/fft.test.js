import { describe, expect, test } from "vitest";
import { fft } from "../../src/domain/fft.js";
import { drawer } from "../../src/engine/prng.js";

describe("fft", () => {
  test("matches a direct DFT of noise to 1e-9", () => {
    const n = 256;
    const next = drawer(1, "fft");
    const input = Float64Array.from({ length: n }, (_, i) => 2 * next(i, 0) - 1);
    const re = input.slice();
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let sumRe = 0;
      let sumIm = 0;
      for (const [t, x] of input.entries()) {
        sumRe += x * Math.cos((-2 * Math.PI * k * t) / n);
        sumIm += x * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(Math.abs(/** @type {number} */ (re[k]) - sumRe)).toBeLessThan(1e-9);
      expect(Math.abs(/** @type {number} */ (im[k]) - sumIm)).toBeLessThan(1e-9);
    }
  });
});

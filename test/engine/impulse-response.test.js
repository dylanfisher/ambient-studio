import { describe, expect, test } from "vitest";
import { impulseResponse } from "../../src/engine/impulse-response.js";

const RATE = 48000;

/**
 * Power of `x` at `hz` over `size` samples from `start`, by the Goertzel recurrence under a
 * Hann window.
 * @param {Float32Array} x
 * @param {number} start
 * @param {number} size
 * @param {number} hz
 */
function powerAt(x, start, size, hz) {
  const coeff = 2 * Math.cos((2 * Math.PI * hz) / RATE);
  let s1 = 0;
  let s2 = 0;
  for (let n = 0; n < size; n++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1));
    const s0 = w * (x[start + n] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * Decay in dB per second at `hz`: the band's power averaged over windows near `from` and near
 * `to` seconds, and the difference divided by the time between them.
 * @param {Float32Array} x
 * @param {number} hz
 * @param {number} from
 * @param {number} to
 */
function decayRate(x, hz, from, to) {
  const size = 2048;
  /** @param {number} at */
  const level = (at) => {
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += powerAt(x, Math.round(at * RATE) + i * size, size, hz);
    return 10 * Math.log10(sum);
  };
  return (level(from) - level(to)) / (to - from);
}

describe("impulseResponse", () => {
  test("is fixed by the seed and differs between seeds", () => {
    expect(impulseResponse(7, 1, RATE)).toEqual(impulseResponse(7, 1, RATE));
    expect(impulseResponse(7, 1, RATE)[0]).not.toEqual(impulseResponse(8, 1, RATE)[0]);
  });

  test("lasts the decay time, in two uncorrelated channels of unit total energy", () => {
    const [left, right] = /** @type {[Float32Array, Float32Array]} */ (
      impulseResponse(3, 1.5, RATE)
    );
    expect(left.length).toBe(1.5 * RATE);
    expect(right.length).toBe(1.5 * RATE);
    let energy = 0;
    let cross = 0;
    for (let i = 0; i < left.length; i++) {
      energy += (left[i] ?? 0) ** 2 + (right[i] ?? 0) ** 2;
      cross += (left[i] ?? 0) * (right[i] ?? 0);
    }
    expect(energy).toBeCloseTo(2, 4);
    expect(Math.abs(cross) / (energy / 2)).toBeLessThan(0.05);
  });

  test("is dark: 4 kHz decays about twice as fast as 125 Hz", () => {
    const decay = 4;
    const [left] = /** @type {[Float32Array]} */ (impulseResponse(11, decay, RATE));
    const low = decayRate(left, 125, 0.2, 1.4);
    const high = decayRate(left, 4000, 0.2, 1.4);
    // An RT60 of 4 s falls 15 dB a second; half of it, 30.
    expect(low).toBeGreaterThan(12);
    expect(low).toBeLessThan(19);
    expect(high / low).toBeGreaterThan(1.5);
    expect(high / low).toBeLessThan(2.6);
  });
});

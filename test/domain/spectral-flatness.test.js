import { describe, expect, test } from "vitest";
import { fft } from "../../src/domain/fft.js";
import { spectralFlatness } from "../../src/domain/spectral-flatness.js";
import { drone, sine, whiteNoise } from "../support/feature-signals.js";
import { SAMPLE_RATE, stereo } from "../support/tech-3341.js";

/**
 * The first 2^18 samples (5.5 s) of `channel` with every bin above `hz` zeroed, through the FFT
 * and back: the inverse is the forward transform of the conjugate, conjugated and scaled.
 * @param {Float32Array} channel at least 2^18 samples
 * @param {number} hz
 */
function bandLimited(channel, hz) {
  const size = 2 ** 18;
  const re = Float64Array.from(channel.subarray(0, size));
  const im = new Float64Array(size);
  fft(re, im);
  const cutoff = Math.ceil((hz / SAMPLE_RATE) * size);
  for (let k = cutoff; k <= size - cutoff; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  for (let k = 0; k < size; k++) im[k] = -(/** @type {number} */ (im[k]));
  fft(re, im);
  return Float32Array.from(re, (x) => x / size);
}

describe("spectralFlatness", () => {
  test("a sine reads under 0.05", () => {
    expect(spectralFlatness(stereo(sine(5, 440)), SAMPLE_RATE)).toBeLessThan(0.05);
  });

  test("a drone of three partials reads under 0.05", () => {
    expect(spectralFlatness(stereo(drone(5)), SAMPLE_RATE)).toBeLessThan(0.05);
  });

  test("white noise reads over 0.8", () => {
    expect(spectralFlatness([whiteNoise(5)], SAMPLE_RATE)).toBeGreaterThan(0.8);
  });

  test("white noise with nothing above 22.05 kHz, as from a 44.1 kHz source, still reads over 0.8", () => {
    expect(spectralFlatness([bandLimited(whiteNoise(6), 22050)], SAMPLE_RATE)).toBeGreaterThan(0.8);
  });

  test("silence has no flatness", () => {
    expect(spectralFlatness([new Float32Array(SAMPLE_RATE)], SAMPLE_RATE)).toBeNull();
  });
});

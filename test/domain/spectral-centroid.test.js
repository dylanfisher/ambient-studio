import { describe, expect, test } from "vitest";
import { spectralCentroid } from "../../src/domain/spectral-centroid.js";
import { whiteNoise } from "../support/feature-signals.js";
import { SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

describe("spectralCentroid", () => {
  test("a 1 kHz sine's centroid is 1 kHz within 1%, with almost no spread", () => {
    const { mean, spread } = spectralCentroid(
      stereo(toneSegments([{ seconds: 5, dbfs: -20 }])),
      SAMPLE_RATE,
    );
    expect(mean).toBeGreaterThan(990);
    expect(mean).toBeLessThan(1010);
    expect(spread).toBeLessThan(10);
  });

  test("white noise's centroid is a quarter of the sample rate within 2%", () => {
    const { mean } = spectralCentroid([whiteNoise(5)], SAMPLE_RATE);
    expect(Math.abs(/** @type {number} */ (mean) / (SAMPLE_RATE / 4) - 1)).toBeLessThan(0.02);
  });

  test("a sine that moves between 500 Hz and 2 kHz has a spread near half the difference", () => {
    const half = 2.5 * SAMPLE_RATE;
    const channel = Float32Array.from({ length: 2 * half }, (_, n) =>
      Math.sin((2 * Math.PI * (n < half ? 500 : 2000) * n) / SAMPLE_RATE),
    );
    const { mean, spread } = spectralCentroid([channel], SAMPLE_RATE);
    expect(mean).toBeGreaterThan(1200);
    expect(mean).toBeLessThan(1300);
    expect(spread).toBeGreaterThan(700);
    expect(spread).toBeLessThan(800);
  });

  test("silence has no centroid", () => {
    expect(spectralCentroid([new Float32Array(SAMPLE_RATE)], SAMPLE_RATE)).toEqual({
      mean: null,
      spread: null,
    });
  });
});

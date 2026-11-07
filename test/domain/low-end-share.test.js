import { describe, expect, test } from "vitest";
import { lowEndShare } from "../../src/domain/low-end-share.js";
import { sine, whiteNoise } from "../support/feature-signals.js";
import { SAMPLE_RATE, stereo } from "../support/tech-3341.js";

describe("lowEndShare", () => {
  test("a 60 Hz sine is almost all low end", () => {
    expect(lowEndShare(stereo(sine(5, 60)), SAMPLE_RATE)).toBeGreaterThan(0.99);
  });

  test("a 1 kHz sine has almost no low end", () => {
    expect(lowEndShare(stereo(sine(5, 1000)), SAMPLE_RATE)).toBeLessThan(0.01);
  });

  test("white noise has about the share of the band under 150 Hz", () => {
    const share = /** @type {number} */ (lowEndShare([whiteNoise(5)], SAMPLE_RATE));
    // Bins 0 to 6 of 1025, 0 to 140.6 Hz.
    expect(share).toBeGreaterThan(0.004);
    expect(share).toBeLessThan(0.01);
  });

  test("silence has no low-end share", () => {
    expect(lowEndShare([new Float32Array(SAMPLE_RATE)], SAMPLE_RATE)).toBeNull();
  });
});

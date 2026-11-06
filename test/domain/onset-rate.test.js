import { describe, expect, test } from "vitest";
import { onsetRate } from "../../src/domain/onset-rate.js";
import { clicks, drone, whiteNoise } from "../support/feature-signals.js";
import { SAMPLE_RATE, stereo } from "../support/tech-3341.js";

describe("onsetRate", () => {
  test.each([1, 2, 5, 8])("clicks at %d a second read within 10%", (rate) => {
    const found = onsetRate(stereo(clicks(10, rate)), SAMPLE_RATE);
    expect(Math.abs(found / rate - 1)).toBeLessThanOrEqual(0.1);
  });

  test("clicks over a drone read within 10%", () => {
    const bed = drone(10);
    const hits = clicks(10, 3);
    const mixed = bed.map((x, n) => x + /** @type {number} */ (hits[n]));
    expect(Math.abs(onsetRate([mixed], SAMPLE_RATE) / 3 - 1)).toBeLessThanOrEqual(0.1);
  });

  test("a sustained drone reads under 0.1 a second", () => {
    expect(onsetRate(stereo(drone(20)), SAMPLE_RATE)).toBeLessThan(0.1);
  });

  test("steady white noise reads under 0.1 a second", () => {
    expect(onsetRate([whiteNoise(20)], SAMPLE_RATE)).toBeLessThan(0.1);
  });

  test("silence has no onsets", () => {
    expect(onsetRate([new Float32Array(5 * SAMPLE_RATE)], SAMPLE_RATE)).toBe(0);
  });
});

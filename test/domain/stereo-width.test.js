import { describe, expect, test } from "vitest";
import { stereoWidth } from "../../src/domain/stereo-width.js";
import { whiteNoise } from "../support/feature-signals.js";
import { SAMPLE_RATE } from "../support/tech-3341.js";

describe("stereoWidth", () => {
  test("identical channels read 0", () => {
    const channel = whiteNoise(5);
    expect(stereoWidth([channel, channel.slice()])).toBe(0);
  });

  test("one channel reads 0, a measured mono", () => {
    expect(stereoWidth([whiteNoise(5)])).toBe(0);
  });

  test("independent noise in each channel reads within 0.05 of 0.5", () => {
    const width = /** @type {number} */ (
      stereoWidth([whiteNoise(5, { seed: 1 }), whiteNoise(5, { seed: 3 })])
    );
    expect(Math.abs(width - 0.5)).toBeLessThan(0.05);
  });

  test("opposite channels read 1", () => {
    const left = whiteNoise(5);
    expect(stereoWidth([left, left.map((x) => -x)])).toBe(1);
  });

  test("silence has no width", () => {
    expect(stereoWidth([new Float32Array(SAMPLE_RATE), new Float32Array(SAMPLE_RATE)])).toBeNull();
  });
});

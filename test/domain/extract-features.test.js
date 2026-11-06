import { describe, expect, test } from "vitest";
import { extractFeatures } from "../../src/domain/extract-features.js";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { normalize } from "../../src/domain/normalize.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { clicks, drone } from "../support/feature-signals.js";
import { SAMPLE_RATE, stereo } from "../support/tech-3341.js";

/** @param {Float32Array[]} channels */
const result = (channels) => ({ channels, sampleRate: SAMPLE_RATE, engineVersion: ENGINE_VERSION });

/** Five seconds of a drone with clicks twice a second, on both channels. */
function excerpt() {
  const hits = clicks(5, 2);
  return stereo(drone(5).map((x, n) => x + 0.25 * /** @type {number} */ (hits[n])));
}

describe("extractFeatures", () => {
  test("on the same samples twice gives identical features", () => {
    const raw = result(excerpt());
    const heard = normalize(raw.channels, SAMPLE_RATE, { target: -16 });
    const first = extractFeatures(raw, heard);
    const second = extractFeatures(
      result(excerpt()),
      normalize(excerpt(), SAMPLE_RATE, { target: -16 }),
    );
    expect(second).toEqual(first);
  });

  test("measures loudness on the raw render and spectrum and onsets on the heard one", () => {
    const raw = result(excerpt());
    const heard = normalize(raw.channels, SAMPLE_RATE, { target: -16 });
    const features = extractFeatures(raw, heard);
    expect(features.raw.loudness).toBeCloseTo(integratedLoudness(raw.channels, SAMPLE_RATE), 6);
    expect(features.heard?.gainDb).toBe(heard.gainDb);
    expect(features.heard?.onsetRate).toBeCloseTo(2, 0);
    expect(features.heard?.centroidMean).toBeGreaterThan(0);
    expect(features.raw.loudnessRange).toBeGreaterThanOrEqual(0);
  });

  test("without a heard excerpt, gives the raw features and null for the heard ones", () => {
    const features = extractFeatures(result(excerpt()), null);
    expect(features.heard).toBeNull();
    expect(Number.isFinite(features.raw.truePeak)).toBe(true);
  });

  test("silence reads null wherever nothing is measurable, so the features survive JSON", () => {
    const features = extractFeatures(result(stereo(new Float32Array(4 * SAMPLE_RATE))), null);
    expect(features.raw).toEqual({
      loudness: null,
      shortTermMax: null,
      loudnessRange: null,
      truePeak: null,
    });
    expect(JSON.parse(JSON.stringify(features))).toEqual(features);
  });
});

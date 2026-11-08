/** @import { Features } from "../../src/domain/extract-features.js" */
import { describe, expect, test } from "vitest";
import { FEATURE_NAMES, featureValue } from "../../src/domain/feature-names.js";
import { MIN_RANGE_WIDTH, rangesFromRegion } from "../../src/domain/ranges-from-region.js";
import { RANGE_BOUNDS, TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { validateTargets } from "../../src/domain/validate-targets.js";

/**
 * A window's features, every value derived from `i` so windows differ.
 * @param {number} i
 * @returns {Features}
 */
const windowFeatures = (i) => ({
  raw: {
    loudness: -20 - i,
    shortTermMax: -12 - i,
    loudnessRange: 2 + ((i * 3) % 7),
    truePeak: -3 + i / 10,
  },
  heard: {
    gainDb: 4,
    centroidMean: 300 + ((i * 37) % 400),
    centroidSpread: 20 + i,
    onsetRate: (i % 3) / 10,
    lowEndShare: 0.4 + ((i * 13) % 50) / 100,
    stereoWidth: 0.05 + (i % 4) / 100,
    flatness: (i % 5) / 100,
  },
});

/**
 * Nearest-rank median, the rule `percentiles` uses.
 * @param {number[]} values
 */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return /** @type {number} */ (sorted[Math.ceil(sorted.length / 2) - 1]);
};

const windows = Array.from({ length: 9 }, (_, i) => windowFeatures(i));

describe("rangesFromRegion", () => {
  test("validates, and holds the windows' median of every feature it names", () => {
    const ranges = rangesFromRegion(windows);
    expect(validateTargets({ features: ranges }).ok).toBe(true);
    expect(Object.keys(ranges)).toEqual(Object.keys(TARGET_FEATURES));
    for (const entry of FEATURE_NAMES) {
      const range = ranges[entry.name];
      if (!range) continue;
      const values = windows.map((w) => /** @type {number} */ (featureValue(w, entry)));
      const [low, high] = /** @type {[number, number]} */ (range);
      expect(low, entry.name).toBeLessThanOrEqual(median(values));
      expect(high, entry.name).toBeGreaterThanOrEqual(median(values));
    }
  });

  test("states a minimum width for every feature a range may name", () => {
    expect(Object.keys(MIN_RANGE_WIDTH)).toEqual(Object.keys(TARGET_FEATURES));
  });

  test("never names the two raw levels", () => {
    const ranges = rangesFromRegion(windows);
    const raw = Object.entries(RANGE_BOUNDS).filter(([, bounds]) => bounds === null);
    expect(raw.map(([name]) => name)).toEqual(["shortTermMax", "truePeak"]);
    for (const [name] of raw) expect(ranges).not.toHaveProperty(name);
  });

  test("is never narrower than the stated minimum width, even inside a bound", () => {
    const same = Array.from({ length: 5 }, () => windowFeatures(0));
    same.forEach((w) => {
      if (w.heard) w.heard.lowEndShare = 0.995;
    });
    const ranges = rangesFromRegion(same);
    for (const [name, range] of Object.entries(ranges)) {
      const [low, high] = /** @type {[number, number]} */ (range);
      const width = /** @type {number} */ (MIN_RANGE_WIDTH[name]);
      expect(high - low, name).toBeGreaterThanOrEqual(width - 1e-9);
    }
    expect(ranges.lowEndShare).toEqual([0.9, 1]);
    // An onset rate of 0 widens up from its bound of 0.
    expect(ranges.onsetRate).toEqual([0, MIN_RANGE_WIDTH.onsetRate]);
  });

  test("takes the 10th and 90th percentiles, rounded outward to the digits the prompt writes", () => {
    const spread = Array.from({ length: 20 }, (_, i) => {
      const w = windowFeatures(0);
      if (w.heard) w.heard.centroidMean = (i + 1) * 100 + 0.4;
      return w;
    });
    expect(rangesFromRegion(spread).centroidMean).toEqual([200, 1801]);
  });

  test("leaves out a feature no window could measure, and reads the others from the windows that could", () => {
    const quiet = { ...windowFeatures(1), heard: null };
    const ranges = rangesFromRegion([quiet, windowFeatures(2)]);
    expect(ranges.loudnessRange).toBeDefined();
    // One window's 374 Hz, widened to 100 Hz around it.
    expect(ranges.centroidMean).toEqual([324, 424]);
    expect(Object.keys(rangesFromRegion([quiet]))).toEqual(["loudnessRange"]);
  });

  test("no windows throws", () => {
    expect(() => rangesFromRegion([])).toThrow(/no windows/);
  });
});

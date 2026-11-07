import { describe, expect, test } from "vitest";
import { extractFeatures } from "../../src/domain/extract-features.js";
import { FEATURE_NAMES, featureValue } from "../../src/domain/feature-names.js";
import { normalize } from "../../src/domain/normalize.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { drone } from "../support/feature-signals.js";
import { SAMPLE_RATE, stereo } from "../support/tech-3341.js";

/** The features of five seconds of a drone, normalized to -16 LUFS. */
function features() {
  const channels = stereo(drone(5));
  const raw = { channels, sampleRate: SAMPLE_RATE, engineVersion: ENGINE_VERSION };
  return extractFeatures(raw, normalize(channels, SAMPLE_RATE, { target: -16 }));
}

describe("FEATURE_NAMES", () => {
  test("is every feature extractFeatures measures but integrated loudness and gain", () => {
    const { raw, heard } = features();
    const measured = [
      ...Object.keys(raw).map((name) => `raw.${name}`),
      ...Object.keys(heard ?? {}).map((name) => `heard.${name}`),
    ].filter((path) => path !== "raw.loudness" && path !== "heard.gainDb");
    expect(FEATURE_NAMES.map(({ set, name }) => `${set}.${name}`).sort()).toEqual(measured.sort());
  });

  test("names each feature once and labels each one differently", () => {
    expect(new Set(FEATURE_NAMES.map(({ name }) => name)).size).toBe(FEATURE_NAMES.length);
    expect(new Set(FEATURE_NAMES.map(({ label }) => label)).size).toBe(FEATURE_NAMES.length);
  });

  test("featureValue reads each entry from its set, and null when nothing was heard", () => {
    const measured = features();
    for (const entry of FEATURE_NAMES) {
      const set = /** @type {Record<string, number | null>} */ (measured[entry.set]);
      expect(featureValue(measured, entry)).toBe(set[entry.name]);
    }
    const heardEntry = FEATURE_NAMES.find(({ set }) => set === "heard");
    expect(featureValue({ ...measured, heard: null }, /** @type {any} */ (heardEntry))).toBeNull();
  });
});

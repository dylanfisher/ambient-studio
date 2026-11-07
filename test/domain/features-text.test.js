import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { featuresText } from "../../src/domain/features-text.js";

const raw = { loudness: -23.44, shortTermMax: -20.06, loudnessRange: 4.21, truePeak: -3.14 };
const heard = {
  gainDb: 7.44,
  centroidMean: 1243.6,
  centroidSpread: 310.2,
  onsetRate: 0.432,
  lowEndShare: 0.3149,
  stereoWidth: 0.1251,
  flatness: 0.0042,
};

describe("featuresText", () => {
  test("writes every feature on one line, rounded, with its unit", () => {
    const text = featuresText({ raw, heard });
    expect(text).not.toMatch(/\n/);
    for (const part of [
      "-23.4 LUFS",
      "-20.1 LUFS",
      "4.2 LU",
      "-3.1 dBTP",
      "+7.4 dB",
      "1244 Hz",
      "310 Hz",
      "0.43 a second",
      "0.31",
      "0.13",
      "0.00",
    ]) {
      expect(text).toContain(part);
    }
  });

  test("names every entry of FEATURE_NAMES", () => {
    const text = featuresText({ raw, heard });
    for (const { label } of FEATURE_NAMES) expect(text).toContain(`${label}: `);
  });

  test("says what couldn't be measured instead of printing null", () => {
    const text = featuresText({
      raw: { loudness: null, shortTermMax: null, loudnessRange: null, truePeak: null },
      heard: null,
    });
    expect(text).not.toMatch(/null|NaN|Infinity/);
    expect(text).toMatch(/too quiet to normalize/);
  });

  test("says a heard feature with no value is none measurable", () => {
    const text = featuresText({ raw, heard: { ...heard, lowEndShare: null, flatness: null } });
    expect(text).not.toMatch(/null|NaN/);
    expect(text).toMatch(/low-end share: none measurable/);
  });
});

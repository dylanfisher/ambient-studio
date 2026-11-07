// Checking an excerpt's features against a vibe's ranges (decision 0034).
import { describe, expect, test } from "vitest";
import { checkTargets } from "../../src/domain/check-targets.js";

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

describe("checkTargets", () => {
  test("finds exactly the misses scripted into the ranges", () => {
    const result = checkTargets(
      { raw, heard },
      {
        loudnessRange: [2, 8], // inside
        centroidMean: [null, 900], // above
        onsetRate: [0.1, null], // inside
        lowEndShare: [0.5, 0.9], // below
        stereoWidth: [0.1, 0.3], // inside
      },
    );
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      {
        path: "features.centroidMean",
        rule: "target",
        message: "spectral centroid is 1244 Hz; the vibe asks for a value at most 900 Hz",
      },
      {
        path: "features.lowEndShare",
        rule: "target",
        message: "low-end share is 0.31; the vibe asks for a value from 0.5 to 0.9",
      },
    ]);
  });

  test("no ranges, or every value inside, is ok", () => {
    expect(checkTargets({ raw, heard }, {})).toEqual({ ok: true, findings: [] });
    expect(checkTargets({ raw, heard }, { flatness: [null, 0.1] })).toEqual({
      ok: true,
      findings: [],
    });
  });

  test("a value is compared at the prompt's rounding, so a miss is one the model can read", () => {
    // 0.3149 reads 0.31, which a range ending at 0.31 holds.
    expect(checkTargets({ raw, heard }, { lowEndShare: [null, 0.31] }).ok).toBe(true);
  });

  test("a value that couldn't be measured is a miss", () => {
    const result = checkTargets(
      { raw: { ...raw, loudnessRange: null }, heard: null },
      { loudnessRange: [2, 8], stereoWidth: [0.1, null] },
    );
    expect(result.findings).toEqual([
      {
        path: "features.loudnessRange",
        rule: "target",
        message: "loudness range couldn't be measured; the vibe asks for a value from 2 to 8 LU",
      },
      {
        path: "features.stereoWidth",
        rule: "target",
        message: "stereo width couldn't be measured; the vibe asks for a value at least 0.1",
      },
    ]);
  });
});

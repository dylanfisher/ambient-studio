// A vibe's soft targets: feature ranges at `features`, other keys kept (decision 0034).
import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { validateTargets } from "../../src/domain/validate-targets.js";

/** One range of each kind: both ends, an open top and an open bottom. */
const ranges = {
  lowEndShare: [0.4, null],
  centroidMean: [null, 800],
  onsetRate: [0.1, 0.5],
};

/** @param {unknown} value */
function errorsOf(value) {
  const result = validateTargets(value);
  if (result.ok) throw new Error("expected errors, got valid soft targets");
  return result.errors;
}

describe("validateTargets", () => {
  test("{} is valid and means no ranges", () => {
    expect(validateTargets({})).toEqual({ ok: true, softTargets: {}, ranges: {} });
  });

  test("a valid range set comes back unchanged", () => {
    expect(validateTargets({ features: ranges })).toEqual({
      ok: true,
      softTargets: { features: ranges },
      ranges,
    });
  });

  test("another key is kept as saved and not checked", () => {
    const softTargets = { clap: { toward: "rain", weight: 0.3 }, features: ranges };
    expect(validateTargets(softTargets)).toEqual({ ok: true, softTargets, ranges });
  });

  test("the table has a range for every feature but the two raw levels", () => {
    expect(Object.keys(TARGET_FEATURES)).toEqual(
      FEATURE_NAMES.map((entry) => entry.name).filter(
        (name) => name !== "shortTermMax" && name !== "truePeak",
      ),
    );
  });

  /** @type {[string, unknown, string, RegExp][]} */
  const refused = [
    ["not an object", [], "$", /must be an object/],
    ["features not an object", { features: [0, 1] }, "$.features", /must be an object/],
    ["an unknown feature", { features: { tempo: [1, 2] } }, "$.features.tempo", /unknown feature/],
    [
      "a raw level",
      { features: { truePeak: [-6, -1] } },
      "$.features.truePeak",
      /raw level.*takes no range/,
    ],
    ["not a pair", { features: { flatness: 0.5 } }, "$.features.flatness", /\[low, high\]/],
    ["a pair of three", { features: { flatness: [0, 0.2, 1] } }, "$.features.flatness", /\[low/],
    ["a non-number", { features: { flatness: ["low", 0.2] } }, "$.features.flatness[0]", /number/],
    ["both ends open", { features: { flatness: [null, null] } }, "$.features.flatness", /open/],
    [
      "low above high",
      { features: { lowEndShare: [0.6, 0.4] } },
      "$.features.lowEndShare",
      /low 0\.6 is above high 0\.4/,
    ],
    ["a share above 1", { features: { stereoWidth: [0, 1.5] } }, "$.features.stereoWidth[1]", /1/],
    ["a negative rate", { features: { onsetRate: [-1, 2] } }, "$.features.onsetRate[0]", /0/],
  ];

  test.each(refused)("%s is refused with its path", (_name, value, path, message) => {
    const errors = errorsOf(value);
    expect(errors.map((e) => e.path)).toEqual([path]);
    expect(errors[0]?.message).toMatch(message);
  });
});

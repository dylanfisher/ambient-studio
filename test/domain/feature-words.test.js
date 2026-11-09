// A candidate's ranged features against the rest of its brief, in words (decision 0085,
// plan WF acceptance 2): only the features that sit high or low among the brief's other
// measured excerpts are named, each with its own words for more and less.
/** @import { Features } from "../../src/domain/extract-features.js" */
import { describe, expect, test } from "vitest";
import { FEATURE_WAYS, featureWords } from "../../src/domain/feature-words.js";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";

const RAW = { loudness: -23, shortTermMax: -20, loudnessRange: 4, truePeak: -3 };
const HEARD = {
  gainDb: 7,
  centroidMean: 400,
  centroidSpread: 30,
  onsetRate: 0.1,
  lowEndShare: 0.5,
  stereoWidth: 0.05,
  flatness: 0,
};

/**
 * Features with some heard and raw values replaced.
 * @param {Partial<typeof HEARD>} heard
 * @param {Partial<typeof RAW>} [raw]
 * @returns {Features}
 */
const at = (heard, raw = {}) =>
  /** @type {Features} */ ({ raw: { ...RAW, ...raw }, heard: { ...HEARD, ...heard } });

/** @type {Features} */
const QUIET = /** @type {Features} */ ({ raw: RAW, heard: null });

/** Ten others, centroid 100 to 1000 Hz. */
const OTHERS = Array.from({ length: 10 }, (_, i) => at({ centroidMean: 100 * (i + 1) }));

describe("featureWords", () => {
  test("every ranged feature has words for more and less", () => {
    expect(Object.keys(FEATURE_WAYS).sort()).toEqual(Object.keys(TARGET_FEATURES).sort());
  });

  test("above nearly all, above most, the middle, below most and below nearly all", () => {
    expect(featureWords(at({ centroidMean: 950 }), OTHERS)).toBe(
      "Against the rest of this brief, it is brighter than nearly all; the rest sit about the middle.",
    );
    expect(featureWords(at({ centroidMean: 750 }), OTHERS)).toContain("brighter than most");
    expect(featureWords(at({ centroidMean: 550 }), OTHERS)).toBe(
      "About the middle of this brief on every measure.",
    );
    expect(featureWords(at({ centroidMean: 250 }), OTHERS)).toContain("darker than most");
    expect(featureWords(at({ centroidMean: 50 }), OTHERS)).toContain("darker than nearly all");
  });

  test("values equal at the prompt's rounding are ties, so a brief all alike sits in the middle", () => {
    const same = Array.from({ length: 6 }, () => at({ lowEndShare: 0.5012 }));
    expect(featureWords(at({ lowEndShare: 0.4988 }), same)).toBe(
      "About the middle of this brief on every measure.",
    );
  });

  test("names several features in the table's order", () => {
    const others = Array.from({ length: 5 }, (_, i) =>
      at({ stereoWidth: 0.1 + i * 0.01 }, { loudnessRange: 2 + i }),
    );
    expect(featureWords(at({ stereoWidth: 0.01 }, { loudnessRange: 9 }), others)).toBe(
      "Against the rest of this brief, it swells and recedes more than nearly all and is narrower than nearly all; the rest sit about the middle.",
    );
  });

  test("too few others, or a candidate too quiet to hear, says so instead of comparing", () => {
    expect(featureWords(at({}), OTHERS.slice(0, 3))).toBe(
      "This brief has too few other measured excerpts to compare it with yet.",
    );
    expect(featureWords(QUIET, OTHERS)).toBe(
      "Too quiet to hear once normalized, so it isn't compared with the rest of this brief.",
    );
  });

  test("another excerpt too quiet to hear isn't counted for a heard feature", () => {
    const others = [...OTHERS.slice(0, 3), QUIET, QUIET];
    expect(featureWords(at({ centroidMean: 950 }), others)).not.toContain("brighter");
  });
});

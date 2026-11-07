import { describe, expect, test } from "vitest";
import { checkTargets } from "../../src/domain/check-targets.js";
import { rangesReadout } from "../../src/web/ranges-readout.js";

/**
 * @param {Partial<Record<string, number | null>>} heard
 * @returns {any}
 */
const features = (heard) => ({
  raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -4 },
  heard: {
    gainDb: 4,
    centroidMean: 900,
    centroidSpread: 200,
    onsetRate: 0.2,
    lowEndShare: 0.4,
    stereoWidth: 0.2,
    flatness: 0.01,
    ...heard,
  },
});

describe("rangesReadout", () => {
  test("gives each range the vibe sets, in the table's order, with the value and a miss mark", () => {
    const ranges = /** @type {any} */ ({
      stereoWidth: [0.3, null],
      centroidMean: [null, 1200],
      loudnessRange: [1, 2],
    });
    const readout = rangesReadout(features({ centroidMean: 1244.4 }), ranges);
    expect(readout.rows).toEqual([
      {
        name: "loudnessRange",
        label: "loudness range",
        value: "3.0 LU",
        range: "from 1 to 2 LU",
        miss: true,
      },
      {
        name: "centroidMean",
        label: "spectral centroid",
        value: "1244 Hz",
        range: "at most 1200 Hz",
        miss: true,
      },
      {
        name: "stereoWidth",
        label: "stereo width",
        value: "0.20",
        range: "at least 0.3",
        miss: true,
      },
    ]);
    expect(readout.misses).toBe(3);
    expect(readout.text).toBe("Misses 3 of the brief's 3 ranges.");
  });

  test("marks a miss exactly where checkTargets finds one, at the prompt's rounding", () => {
    const ranges = /** @type {any} */ ({ lowEndShare: [null, 0.4], onsetRate: [0.1, 0.3] });
    // 0.404 rounds to 0.40, inside; 0.406 rounds to 0.41, a miss.
    for (const lowEndShare of [0.404, 0.406]) {
      const measured = features({ lowEndShare });
      const missed = checkTargets(measured, ranges).findings.length;
      const readout = rangesReadout(measured, ranges);
      expect(readout.misses).toBe(missed);
      expect(readout.rows.filter((row) => row.miss)).toHaveLength(missed);
    }
    expect(rangesReadout(features({ lowEndShare: 0.404 }), ranges).text).toBe(
      "Inside all 2 of the brief's ranges.",
    );
  });

  test("a value that couldn't be measured is a miss and says so", () => {
    const readout = rangesReadout(
      features({ onsetRate: null }),
      /** @type {any} */ ({ onsetRate: [0.1, 0.3] }),
    );
    expect(readout.rows[0]).toMatchObject({ value: "none measurable", miss: true });
  });

  test("a brief with no ranges says so and gives no rows", () => {
    expect(rangesReadout(features({}), {})).toEqual({
      rows: [],
      misses: 0,
      text: "The brief sets no ranges to aim for.",
    });
  });
});

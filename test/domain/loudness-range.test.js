import { describe, expect, test } from "vitest";
import { loudnessRange } from "../../src/domain/loudness-range.js";
import { shortTermLoudness } from "../../src/domain/short-term-loudness.js";
import { SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

// EBU Tech 3342's loudness-range cases 1 to 4, 1 kHz tones in phase on both channels, each
// within the ±1 LU the document allows.

/** @param {[number, number][]} segments seconds and dBFS */
const series = (segments) =>
  shortTermLoudness(
    stereo(toneSegments(segments.map(([seconds, dbfs]) => ({ seconds, dbfs })))),
    SAMPLE_RATE,
  );

describe("loudnessRange on Tech 3342", () => {
  test.each([
    {
      name: "case 1",
      segments: [
        [20, -20],
        [20, -30],
      ],
      range: 10,
    },
    {
      name: "case 2",
      segments: [
        [20, -20],
        [20, -15],
      ],
      range: 5,
    },
    {
      name: "case 3",
      segments: [
        [20, -40],
        [20, -20],
      ],
      range: 20,
    },
    {
      name: "case 4",
      segments: [
        [20, -50],
        [20, -35],
        [20, -20],
        [20, -35],
        [20, -50],
      ],
      range: 15,
    },
  ])("$name reads $range LU", ({ segments, range }) => {
    const found = loudnessRange(series(/** @type {[number, number][]} */ (segments)));
    expect(Math.abs(/** @type {number} */ (found) - range)).toBeLessThanOrEqual(1);
  });

  test("a steady tone reads 0 LU", () => {
    expect(loudnessRange(series([[10, -23]]))).toBeCloseTo(0, 1);
  });

  test("silence and a series shorter than one window have no range", () => {
    expect(loudnessRange(series([[10, -Infinity]]))).toBeNull();
    expect(loudnessRange(new Float64Array(0))).toBeNull();
  });
});

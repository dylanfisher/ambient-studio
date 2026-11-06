import { describe, expect, test } from "vitest";
import { momentaryLoudness } from "../../src/domain/momentary-loudness.js";
import { maxEndingBetween, SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

// EBU Tech 3341 Table 1 cases for momentary loudness (M), each within ±0.1 LU. Element j of the
// series is the 400 ms window that starts at j * 10 ms.

/** @param {Float64Array} series */
function spread(series) {
  return { min: Math.min(...series), max: Math.max(...series) };
}

describe("momentaryLoudness on Tech 3341", () => {
  test.each([
    { name: "case 1", dbfs: -23 },
    { name: "case 2", dbfs: -33 },
  ])("$name reads $dbfs LUFS in every window", ({ dbfs }) => {
    const series = momentaryLoudness(stereo(toneSegments([{ seconds: 20, dbfs }])), SAMPLE_RATE);
    // The K-weighting filter settles within the first window.
    const { min, max } = spread(series.subarray(1));
    expect(min).toBeGreaterThanOrEqual(dbfs - 0.1);
    expect(max).toBeLessThanOrEqual(dbfs + 0.1);
  });

  test("case 12 reads -23 LUFS in every window after 1 s", () => {
    const period = [
      { seconds: 0.18, dbfs: -20 },
      { seconds: 0.22, dbfs: -30 },
    ];
    const series = momentaryLoudness(
      stereo(toneSegments(Array.from({ length: 25 }, () => period).flat())),
      SAMPLE_RATE,
    );
    // Windows that end after 1 s start after 0.6 s.
    const { min, max } = spread(series.subarray(60));
    expect(min).toBeGreaterThanOrEqual(-23.1);
    expect(max).toBeLessThanOrEqual(-22.9);
  });

  test("case 13: each of the 20 segments, measured alone, peaks at -23 LUFS", () => {
    const maxima = Array.from({ length: 20 }, (_, i) => {
      const segment = toneSegments([
        { seconds: i * 0.02, dbfs: -Infinity },
        { seconds: 0.4, dbfs: -23 },
        { seconds: 1, dbfs: -Infinity },
      ]);
      return Math.max(...momentaryLoudness(stereo(segment), SAMPLE_RATE));
    });
    for (const max of maxima) expect(Math.abs(max + 23)).toBeLessThanOrEqual(0.1);
  });

  test("case 14 peaks at -38, -37, ..., -19 LUFS in successive segments", () => {
    const segments = Array.from({ length: 20 }, (_, i) => [
      { seconds: i * 0.02, dbfs: -Infinity },
      { seconds: 0.4, dbfs: -38 + i },
      { seconds: 0.4 - i * 0.02, dbfs: -Infinity },
    ]).flat();
    const series = momentaryLoudness(stereo(toneSegments(segments)), SAMPLE_RATE);
    for (let i = 0; i < 20; i++) {
      const max = maxEndingBetween(series, 0.4, i * 0.8, (i + 1) * 0.8);
      expect(Math.abs(max - (-38 + i))).toBeLessThanOrEqual(0.1);
    }
  });

  test("a signal shorter than 400 ms has no windows", () => {
    const short = toneSegments([{ seconds: 0.39, dbfs: -23 }]);
    expect(momentaryLoudness(stereo(short), SAMPLE_RATE)).toHaveLength(0);
  });

  test("a sample rate other than 48 kHz throws", () => {
    const tone = stereo(toneSegments([{ seconds: 1, dbfs: -23 }]));
    expect(() => momentaryLoudness(tone, 96000)).toThrow(/48000/);
  });
});

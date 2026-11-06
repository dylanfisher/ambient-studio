import { describe, expect, test } from "vitest";
import { shortTermLoudness } from "../../src/domain/short-term-loudness.js";
import { maxEndingBetween, SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

// EBU Tech 3341 Table 1 cases for short-term loudness (S), each within ±0.1 LU. Element j of
// the series is the 3 s window that starts at j * 10 ms.

/** @param {Float64Array} series */
function spread(series) {
  return { min: Math.min(...series), max: Math.max(...series) };
}

describe("shortTermLoudness on Tech 3341", () => {
  test.each([
    { name: "case 1", dbfs: -23 },
    { name: "case 2", dbfs: -33 },
  ])("$name reads $dbfs LUFS in every window", ({ dbfs }) => {
    const series = shortTermLoudness(stereo(toneSegments([{ seconds: 20, dbfs }])), SAMPLE_RATE);
    const { min, max } = spread(series);
    expect(min).toBeGreaterThanOrEqual(dbfs - 0.1);
    expect(max).toBeLessThanOrEqual(dbfs + 0.1);
  });

  test("case 9 reads -23 LUFS in every window after 3 s", () => {
    const period = [
      { seconds: 1.34, dbfs: -20 },
      { seconds: 1.66, dbfs: -30 },
    ];
    const series = shortTermLoudness(
      stereo(toneSegments(Array.from({ length: 5 }, () => period).flat())),
      SAMPLE_RATE,
    );
    expect(series.length).toBeGreaterThan(0);
    const { min, max } = spread(series);
    expect(min).toBeGreaterThanOrEqual(-23.1);
    expect(max).toBeLessThanOrEqual(-22.9);
  });

  test("case 10: each of the 20 segments, measured alone, peaks at -23 LUFS", () => {
    const maxima = Array.from({ length: 20 }, (_, i) => {
      const segment = toneSegments([
        { seconds: i * 0.15, dbfs: -Infinity },
        { seconds: 3, dbfs: -23 },
        { seconds: 1, dbfs: -Infinity },
      ]);
      return Math.max(...shortTermLoudness(stereo(segment), SAMPLE_RATE));
    });
    for (const max of maxima) expect(Math.abs(max + 23)).toBeLessThanOrEqual(0.1);
  });

  test("case 11 peaks at -38, -37, ..., -19 LUFS in successive segments", () => {
    const segments = Array.from({ length: 20 }, (_, i) => [
      { seconds: i * 0.15, dbfs: -Infinity },
      { seconds: 3, dbfs: -38 + i },
      { seconds: 3 - i * 0.15, dbfs: -Infinity },
    ]).flat();
    const series = shortTermLoudness(stereo(toneSegments(segments)), SAMPLE_RATE);
    for (let i = 0; i < 20; i++) {
      const max = maxEndingBetween(series, 3, i * 6, (i + 1) * 6);
      expect(Math.abs(max - (-38 + i))).toBeLessThanOrEqual(0.1);
    }
  });

  test("a sample rate other than 48 kHz throws", () => {
    const tone = stereo(toneSegments([{ seconds: 4, dbfs: -23 }]));
    expect(() => shortTermLoudness(tone, 44100)).toThrow(/48000/);
  });
});

import { describe, expect, test } from "vitest";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

// EBU Tech 3341 Table 1 cases for integrated loudness (I), each within ±0.1 LU.
// Case 6 is 5.0 surround, which this meter doesn't take, and 7 and 8 are recorded programme.
const cases = [
  { name: "case 1", expected: -23, segments: [{ seconds: 20, dbfs: -23 }] },
  { name: "case 2", expected: -33, segments: [{ seconds: 20, dbfs: -33 }] },
  {
    name: "case 3",
    expected: -23,
    segments: [
      { seconds: 10, dbfs: -36 },
      { seconds: 60, dbfs: -23 },
      { seconds: 10, dbfs: -36 },
    ],
  },
  {
    name: "case 4",
    expected: -23,
    segments: [
      { seconds: 10, dbfs: -72 },
      { seconds: 10, dbfs: -36 },
      { seconds: 60, dbfs: -23 },
      { seconds: 10, dbfs: -36 },
      { seconds: 10, dbfs: -72 },
    ],
  },
  {
    name: "case 5",
    expected: -23,
    segments: [
      { seconds: 20, dbfs: -26 },
      { seconds: 20.1, dbfs: -20 },
      { seconds: 20, dbfs: -26 },
    ],
  },
];

describe("integratedLoudness on Tech 3341", () => {
  test.each(cases)("$name reads $expected LUFS within 0.1 LU", ({ expected, segments }) => {
    const lufs = integratedLoudness(stereo(toneSegments(segments)), SAMPLE_RATE);
    expect(Math.abs(lufs - expected)).toBeLessThanOrEqual(0.1);
  });
});

describe("integratedLoudness", () => {
  test("digital silence is -Infinity", () => {
    expect(integratedLoudness(stereo(new Float32Array(SAMPLE_RATE * 5)), SAMPLE_RATE)).toBe(
      -Infinity,
    );
  });

  test("a signal with every block under the -70 LUFS absolute gate is -Infinity", () => {
    const quiet = toneSegments([{ seconds: 5, dbfs: -75 }]);
    expect(integratedLoudness(stereo(quiet), SAMPLE_RATE)).toBe(-Infinity);
  });

  test("a signal shorter than one 400 ms block is -Infinity", () => {
    const short = toneSegments([{ seconds: 0.39, dbfs: -23 }]);
    expect(integratedLoudness(stereo(short), SAMPLE_RATE)).toBe(-Infinity);
  });

  test("a sample rate other than 48 kHz throws", () => {
    const tone = stereo(toneSegments([{ seconds: 1, dbfs: -23 }]));
    expect(() => integratedLoudness(tone, 44100)).toThrow(/48000/);
  });

  test("mono is one channel at weight 1.0, 3.01 dB under the same signal on both channels", () => {
    const tone = toneSegments([{ seconds: 20, dbfs: -23 }]);
    const mono = integratedLoudness([tone], SAMPLE_RATE);
    const dual = integratedLoudness(stereo(tone), SAMPLE_RATE);
    expect(dual - mono).toBeCloseTo(10 * Math.log10(2), 3);
  });

  test("stereo channels have equal weight", () => {
    const tone = toneSegments([{ seconds: 20, dbfs: -23 }]);
    const silent = new Float32Array(tone.length);
    const left = integratedLoudness([tone, silent], SAMPLE_RATE);
    const right = integratedLoudness([silent, tone], SAMPLE_RATE);
    expect(left).toBeCloseTo(right, 6);
    expect(left).toBeCloseTo(integratedLoudness([tone], SAMPLE_RATE), 6);
  });

  test("more than two channels throws, since their weights depend on speaker position", () => {
    const tone = toneSegments([{ seconds: 1, dbfs: -23 }]);
    expect(() => integratedLoudness([tone, tone, tone], SAMPLE_RATE)).toThrow(/channels/);
  });

  test("channels of different lengths throw", () => {
    const tone = toneSegments([{ seconds: 1, dbfs: -23 }]);
    expect(() => integratedLoudness([tone, tone.subarray(1)], SAMPLE_RATE)).toThrow(/length/);
  });
});

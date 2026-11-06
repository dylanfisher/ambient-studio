import { describe, expect, test } from "vitest";
import { truePeak } from "../../src/domain/true-peak.js";
import { SAMPLE_RATE, splicedBurst, stereo, taperedSine } from "../support/tech-3341.js";

// EBU Tech 3341 Table 1 cases 15 to 23: maximum true-peak level within +0.2/-0.4 dB.
const fs = SAMPLE_RATE;
const sineCases = [
  { name: "case 15", frequency: fs / 4, amplitude: 0.5, degrees: 0, expected: -6 },
  { name: "case 16", frequency: fs / 4, amplitude: 0.5, degrees: 45, expected: -6 },
  { name: "case 17", frequency: fs / 6, amplitude: 0.5, degrees: 60, expected: -6 },
  { name: "case 18", frequency: fs / 8, amplitude: 0.5, degrees: 67.5, expected: -6 },
  { name: "case 19", frequency: fs / 4, amplitude: 1.41, degrees: 45, expected: 3 },
];

/**
 * @param {number} measured
 * @param {number} expected
 */
function withinTolerance(measured, expected) {
  expect(measured).toBeGreaterThanOrEqual(expected - 0.4);
  expect(measured).toBeLessThanOrEqual(expected + 0.2);
}

describe("truePeak on Tech 3341", () => {
  test.each(sineCases)("$name reads $expected dBTP", ({ expected, ...tone }) => {
    withinTolerance(truePeak(stereo(taperedSine({ ...tone, seconds: 1 })), SAMPLE_RATE), expected);
  });

  test.each([0, 1, 2, 3].map((offset) => ({ name: `case ${20 + offset}`, offset })))(
    "$name, the burst decimated at offset $offset, reads 0 dBTP",
    ({ offset }) => {
      withinTolerance(truePeak(stereo(splicedBurst(offset)), SAMPLE_RATE), 0);
    },
  );
});

describe("truePeak", () => {
  test("reads above the sample peak when the waveform peaks between samples", () => {
    const tone = taperedSine({ frequency: fs / 4, amplitude: 0.5, degrees: 45, seconds: 1 });
    const samplePeak = 20 * Math.log10(Math.max(...tone.map(Math.abs)));
    expect(truePeak([tone], SAMPLE_RATE)).toBeGreaterThan(samplePeak + 2.5);
  });

  test("is the louder channel's peak", () => {
    const quiet = taperedSine({ frequency: fs / 8, amplitude: 0.1, degrees: 0, seconds: 1 });
    const loud = taperedSine({ frequency: fs / 8, amplitude: 0.5, degrees: 0, seconds: 1 });
    expect(truePeak([quiet, loud], SAMPLE_RATE)).toBeCloseTo(truePeak([loud], SAMPLE_RATE), 9);
  });

  test("a single full-scale sample at the end of the signal is still measured", () => {
    const impulse = new Float32Array(100);
    impulse[99] = 1;
    expect(truePeak([impulse], SAMPLE_RATE)).toBeGreaterThan(-1);
  });

  test("digital silence is -Infinity", () => {
    expect(truePeak(stereo(new Float32Array(SAMPLE_RATE)), SAMPLE_RATE)).toBe(-Infinity);
  });

  test("a sample rate other than 48 kHz throws", () => {
    expect(() => truePeak([new Float32Array(10)], 44100)).toThrow(/48000/);
  });
});

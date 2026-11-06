import { describe, expect, test } from "vitest";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { normalize } from "../../src/domain/normalize.js";
import { truePeak } from "../../src/domain/true-peak.js";
import { dbToGain, SAMPLE_RATE, stereo } from "../support/tech-3341.js";

const fs = SAMPLE_RATE;

/**
 * A sum of sines with amplitudes given at their peaks.
 * @param {{ frequency: number, amplitude: number }[]} partials
 * @param {number} seconds
 */
function sines(partials, seconds) {
  const out = new Float32Array(Math.round(seconds * fs));
  for (let n = 0; n < out.length; n++) {
    let value = 0;
    for (const { frequency, amplitude } of partials) {
      value += amplitude * Math.sin((2 * Math.PI * frequency * n) / fs);
    }
    out[n] = value;
  }
  return out;
}

/**
 * Scales `channels` in place to `lufs` by our meter.
 * @param {Float32Array[]} channels
 * @param {number} lufs
 */
function atLoudness(channels, lufs) {
  const gain = dbToGain(lufs - integratedLoudness(channels, fs));
  for (const channel of channels) channel.set(channel.map((x) => x * gain));
  return channels;
}

/**
 * Adds a 2 ms decaying 3 kHz burst at full scale to `channel` every `everySeconds`.
 * @param {Float32Array} channel
 * @param {number} everySeconds
 */
function withBursts(channel, everySeconds) {
  const length = Math.round(0.002 * fs);
  for (let start = fs / 4; start + length < channel.length; start += everySeconds * fs) {
    for (let k = 0; k < length; k++) {
      const index = Math.round(start) + k;
      channel[index] =
        (channel[index] ?? 0) +
        Math.exp(-k / (length / 4)) * Math.sin((2 * Math.PI * 3000 * k) / fs);
    }
  }
  return channel;
}

// 80% of the energy is the 55 Hz fundamental: energy goes with amplitude squared, and
// 0.8^2 / (0.8^2 + 0.3^2 + 0.25^2 + 0.2^2 + 0.15^2) = 0.80.
const bassPartials = [
  { frequency: 55, amplitude: 0.8 },
  { frequency: 110, amplitude: 0.3 },
  { frequency: 165, amplitude: 0.25 },
  { frequency: 330, amplitude: 0.2 },
  { frequency: 660, amplitude: 0.15 },
];

/**
 * @param {{ channels: Float32Array[] }} result
 */
function measured(result) {
  return {
    loudness: integratedLoudness(result.channels, fs),
    peak: truePeak(result.channels, fs),
  };
}

describe("normalize", () => {
  test("a sine at -30 LUFS reaches -20 LUFS with true peak at or under -1 dBTP", () => {
    const input = atLoudness(stereo(sines([{ frequency: 1000, amplitude: 1 }], 5)), -30);
    const { loudness, peak } = measured(normalize(input, fs, { target: -20 }));
    expect(Math.abs(loudness + 20)).toBeLessThanOrEqual(0.5);
    expect(peak).toBeLessThanOrEqual(-1);
  });

  test.each([-30, -16, -12, -10])("a bass-heavy tone reaches %d LUFS at -1 dBTP", (target) => {
    const input = atLoudness(stereo(sines(bassPartials, 10)), -40);
    const { loudness, peak } = measured(normalize(input, fs, { target, ceiling: -1 }));
    expect(Math.abs(loudness - target)).toBeLessThanOrEqual(0.1);
    expect(peak).toBeLessThanOrEqual(-1);
  });

  test("passes continue until within 0.1 LU when limiting takes loudness back", () => {
    // A swell over 8 s, so the limiter works on the loud half only.
    const tone = sines(bassPartials, 20).map(
      (x, n) => 0.05 * x * (1 + 0.8 * Math.sin((2 * Math.PI * n) / (8 * fs))),
    );
    const { loudness, peak } = measured(
      normalize(stereo(withBursts(tone, 3.7)), fs, { target: -10 }),
    );
    expect(Math.abs(loudness + 10)).toBeLessThanOrEqual(0.1);
    expect(peak).toBeLessThanOrEqual(-1);
  });

  test("sharp transients are limited without true peak crossing the ceiling", () => {
    const pad = sines([{ frequency: 220, amplitude: 0.05 }], 10);
    const input = stereo(withBursts(pad, 0.5));
    const result = normalize(input, fs, { target: -16 });
    // Unlimited, the gain would put the bursts well over the ceiling.
    expect(truePeak(input, fs) + result.gainDb).toBeGreaterThan(5);
    const { loudness, peak } = measured(result);
    expect(Math.abs(loudness + 16)).toBeLessThanOrEqual(0.5);
    expect(peak).toBeLessThanOrEqual(-1);
  });

  test("a peak in the first samples is limited", () => {
    const tone = sines([{ frequency: 1000, amplitude: 0.03 }], 3);
    for (let k = 0; k < 96; k++)
      tone[k] = Math.exp(-k / 24) * Math.sin((2 * Math.PI * 3000 * k) / fs);
    expect(measured(normalize(stereo(tone), fs, { target: -14 })).peak).toBeLessThanOrEqual(-1);
  });

  test("the limiter's gain changes by at most 0.005 a sample", () => {
    const pad = sines([{ frequency: 220, amplitude: 0.03 }], 4);
    const input = stereo(withBursts(pad, 1));
    const result = normalize(input, fs, { target: -16 });
    const gain = dbToGain(result.gainDb);
    const source = input[0] ?? new Float32Array();
    const output = result.channels[0] ?? new Float32Array();
    let previous = 1;
    let previousIndex = -1;
    let largestStep = 0;
    let deepest = 1;
    for (let n = 0; n < source.length; n++) {
      // Only where the source is far from zero, so the ratio isn't dominated by rounding.
      if (Math.abs(source[n] ?? 0) < 0.01) continue;
      const applied = (output[n] ?? 0) / ((source[n] ?? 0) * gain);
      if (previousIndex >= 0) {
        largestStep = Math.max(largestStep, Math.abs(applied - previous) / (n - previousIndex));
      }
      deepest = Math.min(deepest, applied);
      previous = applied;
      previousIndex = n;
    }
    expect(deepest).toBeLessThan(0.5);
    expect(largestStep).toBeLessThanOrEqual(0.005);
  });

  test("a signal under the ceiling gets the gain and nothing else", () => {
    const input = atLoudness(stereo(sines(bassPartials, 5)), -30);
    const result = normalize(input, fs, { target: -20 });
    const gain = dbToGain(result.gainDb);
    input.forEach((channel, c) => {
      const expected = channel.map((x) => x * gain);
      expect(result.channels[c]).toEqual(expected);
    });
  });

  test("the same input gives identical output", () => {
    const make = () => stereo(withBursts(sines([{ frequency: 220, amplitude: 0.05 }], 3), 0.5));
    const a = normalize(make(), fs, { target: -14 });
    const b = normalize(make(), fs, { target: -14 });
    expect(a.channels).toEqual(b.channels);
  });

  test("it leaves the input unchanged", () => {
    const input = stereo(withBursts(sines([{ frequency: 220, amplitude: 0.05 }], 3), 0.5));
    const copy = input.map((channel) => channel.slice());
    normalize(input, fs, { target: -14 });
    expect(input).toEqual(copy);
  });

  test("gain beyond the cap throws", () => {
    const input = atLoudness(stereo(sines([{ frequency: 1000, amplitude: 1 }], 3)), -60);
    expect(() => normalize(input, fs, { target: -16 })).toThrow(/44\.0 dB.*40 dB cap/);
  });

  test("a signal with no loudness throws", () => {
    const input = stereo(new Float32Array(3 * fs));
    expect(() => normalize(input, fs, { target: -16 })).toThrow(/-Infinity/);
  });

  test("a signal limiting can't bring to the target throws naming the final error", () => {
    // Full-scale bursts every 100 ms hold the limiter down, so more gain can't raise the tone.
    const input = stereo(withBursts(sines([{ frequency: 1000, amplitude: 0.03 }], 5), 0.1));
    expect(() => normalize(input, fs, { target: -10 })).toThrow(
      /can't reach -10 LUFS: .* LUFS, -?\d+\.\d LU from the target/,
    );
  });

  test("a missing target throws", () => {
    const input = stereo(sines([{ frequency: 1000, amplitude: 0.1 }], 3));
    // @ts-expect-error the target is required
    expect(() => normalize(input, fs, {})).toThrow(/target/);
  });
});

import { describe, expect, test } from "vitest";
import { coloredNoise, NOISE_COLORS } from "../../src/engine/colored-noise.js";
import { fft } from "../support/golden.js";

const RATE = 48000;
const FFT_SIZE = 4096;
/** Octave bands whose slope is measured, by their lower edge in Hz. */
const OCTAVES = [100, 200, 400, 800, 1600, 3200, 6400];
// Measured on mbp2021 over 2^19 samples, seeds 1–6, in dB an octave from 100 Hz to 12.8 kHz:
// white −0.01 to 0.03, pink −3.02 to −2.97, brown −5.95 to −5.90 (the leaky integrator flattens
// a little toward its corner and toward Nyquist).
const SLOPE = { white: 0, pink: -3, brown: -6 };
const SLOPE_TOLERANCE = 0.25;

/** @param {Partial<Parameters<typeof coloredNoise>[0]>} overrides */
const noise = (overrides) =>
  coloredNoise({
    seed: 1,
    voiceId: "bed",
    slot: 1,
    color: "pink",
    channel: 0,
    channels: 2,
    first: 0,
    frames: RATE,
    ...overrides,
  });

/**
 * The slope in dB an octave of the least-squares line through the mean power of each octave
 * band, from Hann-windowed FFT blocks.
 * @param {Float32Array} x
 */
function octaveSlope(x) {
  const power = new Float64Array(FFT_SIZE / 2);
  for (let start = 0; start + FFT_SIZE <= x.length; start += FFT_SIZE / 2) {
    const re = Float64Array.from(
      { length: FFT_SIZE },
      (_, i) => (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE)),
    );
    const im = new Float64Array(FFT_SIZE);
    fft(re, im);
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      power[k] = (power[k] ?? 0) + (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    }
  }
  const points = OCTAVES.map((lo) => {
    const from = Math.ceil((lo * FFT_SIZE) / RATE);
    const to = Math.ceil((2 * lo * FFT_SIZE) / RATE);
    const band = power.subarray(from, to);
    // Mean power per bin, so the band's width doesn't count.
    const mean = band.reduce((a, b) => a + b, 0) / band.length;
    return { x: Math.log2(lo), y: 10 * Math.log10(mean) };
  });
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const sxy = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return sxy / sxx;
}

/** @param {Float32Array} x */
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("coloredNoise", () => {
  test.each(NOISE_COLORS)("%s noise slopes as its color names", (color) => {
    for (const seed of [1, 2]) {
      const slope = octaveSlope(noise({ seed, color, frames: 2 ** 19 }));
      expect(Math.abs(slope - SLOPE[color]), `seed ${seed}: ${slope} dB an octave`).toBeLessThan(
        SLOPE_TOLERANCE,
      );
    }
  });

  test.each(NOISE_COLORS)("%s noise has the RMS of uniform white noise", (color) => {
    expect(rms(noise({ color, frames: 4 * RATE }))).toBeCloseTo(1 / Math.sqrt(3), 1);
  });

  test.each(NOISE_COLORS)(
    "%s noise at a frame is the same whichever stretch computes it",
    (color) => {
      const whole = noise({ color, first: 0, frames: 3 * RATE });
      const part = noise({ color, first: RATE + 17, frames: RATE });
      const same = whole.subarray(RATE + 17, 2 * RATE + 17);
      const peak = part.reduce((max, v, i) => Math.max(max, Math.abs(v - (same[i] ?? 0))), 0);
      expect(peak).toBeLessThan(1e-6);
    },
  );

  test("is fixed by the seed and the channel, and differs between them", () => {
    expect(noise({})).toEqual(noise({}));
    expect(noise({})).not.toEqual(noise({ seed: 2 }));
    expect(noise({})).not.toEqual(noise({ channel: 1 }));
  });

  test("frames before timeline 0 are silence", () => {
    const x = noise({ color: "brown", first: -100, frames: 200 });
    expect(x.subarray(0, 100).every((v) => v === 0)).toBe(true);
    expect(Array.from(x.subarray(100))).toEqual(Array.from(noise({ color: "brown", frames: 100 })));
  });
});

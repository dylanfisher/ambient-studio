// Comparisons between renders that the engine promises match: an excerpt against the same window
// of a full render within 0007's tolerance, and a render with every window created up front
// against the windowed one.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { RenderResult } from "../../src/engine/render-plan.js" */
import { expect } from "vitest";
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { renderOffline } from "../../src/server/render-offline.js";

// The stated tolerance, from renders measured on mbp2021: an excerpt differs from its window of
// a full render by at most a peak of 1e-5, with the difference at least 100 dB under the signal
// (decision 0007).
const EXCERPT_PEAK = 1e-5;
const EXCERPT_BELOW_DB = 100;

/**
 * Largest absolute difference between two renders, and the difference's RMS in dB below the
 * reference's RMS.
 * @param {RenderResult} result
 * @param {RenderResult} reference
 */
export function difference(result, reference) {
  let peak = 0;
  let diff = 0;
  let signal = 0;
  reference.channels.forEach((ref, c) => {
    const data = /** @type {Float32Array} */ (result.channels[c]);
    expect(data.length).toBe(ref.length);
    for (let i = 0; i < ref.length; i++) {
      const d = (data[i] ?? 0) - (ref[i] ?? 0);
      peak = Math.max(peak, Math.abs(d));
      diff += d * d;
      signal += (ref[i] ?? 0) ** 2;
    }
  });
  return { peak, belowDb: 10 * Math.log10(signal / diff) };
}

/**
 * Renders `full` seconds from 0 and an excerpt of `length` seconds at `offset`, and checks the
 * excerpt against the same window of the full render within 0007's tolerance.
 * @param {Genome} genome
 * @param {{ seed: number; full: number; offset: number; length: number }} times
 */
export async function expectExcerptMatches(genome, { seed, full, offset, length }) {
  const whole = await renderOffline(genome, { seed, duration: full });
  const excerpt = await renderOffline(genome, { seed, duration: length, offset });
  const from = Math.round(offset * SAMPLE_RATE);
  const window = {
    ...whole,
    channels: whole.channels.map((c) => c.slice(from, from + Math.round(length * SAMPLE_RATE))),
  };
  const { peak, belowDb } = difference(excerpt, window);
  expect(peak).toBeLessThan(EXCERPT_PEAK);
  expect(belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  return { excerpt, window, peak, belowDb };
}

/**
 * A render with every window created at once: without `suspend`, `render()` treats the context
 * as live.
 * @param {Genome} genome
 * @param {{ seed: number; duration: number }} options
 */
export const renderUpFront = (genome, options) =>
  renderOffline(genome, options, (ctx) =>
    Object.defineProperty(ctx, "suspend", { value: undefined }),
  );

/** @param {RenderResult} result */
export const rms = (result) =>
  Math.sqrt(
    result.channels.reduce((sum, c) => sum + c.reduce((s, x) => s + x * x, 0), 0) /
      result.channels.reduce((n, c) => n + c.length, 0),
  );

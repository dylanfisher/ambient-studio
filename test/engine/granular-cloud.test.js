// Renders are short (2–6 s) to keep the gate light on a machine that also serves omlx.
import { describe, expect, test } from "vitest";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import cloudGenome from "../../src/engine/genomes/granular-cloud.json" with { type: "json" };
import {
  CANDIDATE_RATE,
  grainEvents,
  grainSource,
  granularCloud,
  mixGrains,
} from "../../src/engine/granular-cloud.js";
import { resolvePitch, tuningFrequencies } from "../../src/engine/pitch.js";
import { draw, TRIGGER_SLOT } from "../../src/engine/prng.js";
import { getTuning } from "../../src/engine/tuning-registry.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { expectExcerptMatches, renderUpFront } from "../support/compare-renders.js";
import { recordSources } from "../support/record-sources.js";
import { renderOffline } from "../support/render-offline.js";

const RATE = 48000;
const golden = requireGenome(cloudGenome, "the granular golden genome");
const [goldenVoice] = cloudGenome.voices;

/**
 * The golden genome with its voice changed, other parameters left as they are.
 * @param {Record<string, unknown>} change
 * @param {Record<string, unknown>} [globals]
 */
const withVoice = (change, globals = {}) =>
  requireGenome(
    { ...cloudGenome, ...globals, voices: [{ ...goldenVoice, ...change }] },
    "a granular genome",
  );

/**
 * @param {import("../../src/engine/genome-schema.js").Genome} genome
 * @param {number} from
 * @param {number} to
 * @param {number} [seed]
 */
const grains = (genome, from, to, seed = 1) =>
  grainEvents({
    genome,
    voice: /** @type {import("../../src/engine/genome-schema.js").Voice} */ (genome.voices[0]),
    seed,
    from,
    to,
    sampleRate: RATE,
  });

/** @param {number} a @param {number} b */
const cents = (a, b) => 1200 * Math.log2(a / b);

describe("the granular cloud", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(granularCloud.type);
  });

  test("the golden genome uses a trajectory and a non-neutral macro", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([granularCloud.type]);
    expect(golden.voices[0]?.density).toHaveProperty("points");
    expect(golden.macros.motion).not.toBe(0.5);
    // Motion is mapped onto the pitch spread, so the macro widens it.
    const neutral = { ...golden, macros: { ...golden.macros, motion: 0.5 } };
    const spread = (/** @type {typeof golden} */ g) =>
      /** @type {number} */ (effectiveParams(g, 2).voices[0]?.spread);
    expect(spread(golden)).toBeGreaterThan(spread(neutral));
  });

  test("the grain count over a duration matches the seed exactly and the density on average", () => {
    const seconds = 600;
    for (const density of [2, 8, 25]) {
      const genome = withVoice({ density });
      const found = grains(genome, 0, seconds);
      // Thinning: candidate k fires when its trigger draw is under density / CANDIDATE_RATE, and
      // every candidate under 600 s starts in [0, 600).
      let expected = 0;
      for (let k = 0; k < seconds * CANDIDATE_RATE; k++) {
        if (draw(1, "cloud", k, TRIGGER_SLOT) < density / CANDIDATE_RATE) expected++;
      }
      expect(found.length).toBe(expected);
      const mean = density * seconds;
      const sd = Math.sqrt(mean * (1 - density / CANDIDATE_RATE));
      expect(Math.abs(found.length - mean), `density ${density}`).toBeLessThan(4 * sd);
    }
  });

  test("windows hold the grains of the whole span between them, and the seed picks them", () => {
    const whole = grains(golden, 0, 20);
    const windowed = Array.from({ length: 10 }, (_, w) => grains(golden, 2 * w, 2 * w + 2)).flat();
    expect(windowed).toEqual(whole);
    expect(grains(golden, 0, 20, 2)).not.toEqual(whole);
    for (const grain of whole) expect(grain.frame).toBeGreaterThanOrEqual(0);
  });

  test("grain pitches are scale notes, detuned by at most the voice's detune", () => {
    const pentatonic = resolvePitch(getTuning("12-tet"), "minor-pentatonic", 9);
    const notes = tuningFrequencies(pentatonic, 30, 3000);
    const found = grains(golden, 2, 30);
    expect(found.length).toBeGreaterThan(100);
    for (const grain of found) {
      expect(notes).toContain(grain.note);
      expect(Math.abs(cents(grain.hz, grain.note))).toBeLessThanOrEqual(goldenVoice?.detune ?? 0);
    }
  });

  test("in an absolute tuning, each grain plays within 30 cents of a tuning member", () => {
    const { key: _, ...relative } = cloudGenome;
    const genome = requireGenome(
      {
        ...relative,
        tuning: "colundi",
        scale: "core18",
        voices: [{ ...goldenVoice, detune: 12, spread: 2 }],
      },
      "a Colundi cloud",
    );
    const members = tuningFrequencies(resolvePitch(getTuning("colundi"), "core18"), 30, 3000);
    const found = grains(genome, 2, 30);
    expect(new Set(found.map((g) => g.note)).size).toBeGreaterThan(5);
    for (const grain of found) {
      expect(members).toContain(grain.note);
      expect(Math.abs(cents(grain.hz, grain.note))).toBeLessThanOrEqual(30);
    }
  });

  test("no grain starts or ends with a step: each rises from 0 and falls back to it", () => {
    const source = grainSource(1, "cloud", RATE);
    const shortest = withVoice({ size: 0.02, density: 30 });
    for (const genome of [golden, shortest]) {
      for (const grain of grains(genome, 2, 4)) {
        const [left] = mixGrains([grain], source, grain.frame - 1, RATE);
        const x = /** @type {Float32Array} */ (left);
        const peak = x.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
        // Silence before the grain, then its first and last samples, against its peak.
        expect(x.length).toBe(grain.frames + 1);
        expect(x[0]).toBe(0);
        expect(Math.abs(x[1] ?? 1)).toBeLessThan(1e-4 * peak);
        expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(1e-4 * peak);
        // The largest step between samples is in the middle, not at the edges.
        const edge = Math.round(grain.frames / 20);
        /** @param {number} from @param {number} to */
        const largestStep = (from, to) => {
          let step = 0;
          for (let i = from; i < to; i++) {
            step = Math.max(step, Math.abs((x[i + 1] ?? 0) - (x[i] ?? 0)));
          }
          return step;
        };
        const middle = largestStep(0, x.length - 1);
        expect(largestStep(0, edge)).toBeLessThan(0.1 * middle);
        expect(largestStep(x.length - 1 - edge, x.length - 1)).toBeLessThan(0.1 * middle);
      }
    }
  });

  test("the source tone loops without a seam and is fixed by the seed", () => {
    const source = grainSource(1, "cloud", RATE);
    expect(source[source.length - 1]).toBe(source[0]);
    expect(source).toEqual(grainSource(1, "cloud", RATE));
    expect(source).not.toEqual(grainSource(2, "cloud", RATE));
    const peak = source.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    expect(peak).toBeCloseTo(1, 6);
  });

  test("costs its densest setting, counting a trajectory's highest point and the macros", () => {
    const fixed = cost(withVoice({ density: 20, size: 0.15 }));
    const swept = cost(
      withVoice({
        density: {
          points: [
            [0, 2],
            [30, 20, "smooth"],
          ],
        },
        size: 0.15,
      }),
    );
    expect(swept).toBeCloseTo(fixed, 9);
    expect(cost(withVoice({ density: 8, size: 0.15 }))).toBeLessThan(fixed);
    const pushed = withVoice({ density: 20, size: 0.15 }, { macros: { density: 1 } });
    expect(cost(pushed)).toBeGreaterThan(fixed);
  });

  test("stays in the budget at its highest density and longest grains", () => {
    const densest = withVoice(
      { density: 30, size: 0.5, root: 1200, spread: 2 },
      { reverbDecay: GLOBAL_PARAMS.reverbDecay.default, macros: { density: 1, motion: 1 } },
    );
    expect(cost(densest)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("plays each window's grains from one buffer source, starting on the window's first frame", async () => {
    /** @type {import("../support/record-sources.js").StartedSource[]} */
    let started = [];
    await renderOffline(golden, { seed: 1, duration: 5 }, (ctx) => {
      started = recordSources(ctx);
    });
    const expected = [0, 2, 4].flatMap((from) => {
      const found = grains(golden, from, Math.min(from + 2, 5));
      if (found.length === 0) return [];
      const end = Math.max(...found.map((g) => g.frame + g.frames));
      return [{ frame: from * RATE, frames: end - from * RATE }];
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(started).toEqual(expected);
  });

  test("scheduling in suspend windows renders the same samples as scheduling up front", async () => {
    const windowed = await renderOffline(golden, { seed: 1, duration: 5 });
    expect((await renderUpFront(golden, { seed: 1, duration: 5 })).channels).toEqual(
      windowed.channels,
    );
  });

  test("plays only from its start to its end, and an excerpt across its end matches", async () => {
    const genome = requireGenome(
      {
        ...cloudGenome,
        voices: cloudGenome.voices.map((v) => ({ ...v, start: 2.3, end: 6.7 })),
      },
      "the golden with voices starting and ending inside the render",
    );
    /** @type {import("../support/record-sources.js").StartedSource[]} */
    let started = [];
    const whole = await renderOffline(genome, { seed: 1, duration: 9 }, (ctx) => {
      started = recordSources(ctx);
    });
    // No buffer for the window before the start or the one after the end.
    expect(started.length).toBeGreaterThan(0);
    for (const { frame } of started) {
      expect(frame).toBeGreaterThanOrEqual(2 * RATE);
      expect(frame).toBeLessThan(8 * RATE);
    }
    // Silent before the start, but for the library's gate ramp reaching up to a quantum early
    // (measured 3e-12 for the noise golden, 3e-10 for the drone's); sounding between start and
    // end.
    const left = /** @type {Float32Array} */ (whole.channels[0]);
    expect(left.subarray(0, Math.round(2.3 * RATE)).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(left.subarray(3 * RATE, 6 * RATE).some((v) => Math.abs(v) > 1e-4)).toBe(true);
    await expectExcerptMatches(genome, { seed: 1, full: 9, offset: 5.5, length: 2.5 });
  });

  test("an excerpt matches the same window of a longer render (0007's tolerance)", async () => {
    const { excerpt } = await expectExcerptMatches(golden, {
      seed: 1,
      full: 8,
      offset: 5.5,
      length: 2.5,
    });
    // The excerpt isn't silent, so the match means something.
    expect(excerpt.channels[0]?.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  });
});

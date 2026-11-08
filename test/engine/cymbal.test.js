// The cymbal (decision 0071). Hits are checked from the voice's JS directly, which is cheap;
// renders are short to keep the gate light on a machine that also serves omlx.
/** @import { Genome, Voice } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { fft } from "../../src/domain/fft.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { eventCost } from "../../src/engine/cost-unit.js";
import { cymbal, cymbalHit, cymbalHits } from "../../src/engine/cymbal.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import cymbalGenome from "../../src/engine/genomes/cymbal.json" with { type: "json" };
import { fires } from "../../src/engine/prng.js";
import { requireGenome, validateGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { expectExcerptMatches, renderUpFront, rms } from "../support/compare-renders.js";

const RATE = 48000;
const golden = requireGenome(cymbalGenome, "the cymbal golden genome");
/** Candidates every 2 s, each starting up to half a step late. */
const STEP = 2;

/**
 * A genome with one cymbal of fixed density, neutral macros, a short reverb, and `change` on
 * the voice.
 * @param {Record<string, unknown>} change
 */
const oneCymbal = (change = {}) =>
  requireGenome(
    {
      reverbDecay: 1,
      delayFeedback: 0,
      voices: [{ id: "cymbal", type: "cymbal", density: 4, ...change }],
    },
    "one cymbal",
  );

/** @param {Genome} genome */
const firstVoice = (genome) => /** @type {Voice} */ (genome.voices[0]);

/**
 * The voice's effective values at 0 s, as a hit reads them.
 * @param {Genome} genome
 */
const settingsOf = (genome) => /** @type {any} */ (effectiveParams(genome, 0).voices[0]);

/**
 * The share of `samples`' energy above `hz`, from one FFT of the whole, zero-padded.
 * @param {ArrayLike<number>} samples
 * @param {number} hz
 */
function shareAbove(samples, hz) {
  let size = 1;
  while (size < samples.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < samples.length; i++) re[i] = samples[i] ?? 0;
  fft(re, im);
  let above = 0;
  let total = 0;
  for (let k = 0; k <= size / 2; k++) {
    const power = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    total += power;
    if ((k * RATE) / size > hz) above += power;
  }
  return above / total;
}

/**
 * The RMS level in dB of the 100 ms of `samples` from `seconds`.
 * @param {Float32Array} samples
 * @param {number} seconds
 */
function levelAt(samples, seconds) {
  const from = Math.round(seconds * RATE);
  const frame = samples.subarray(from, from + RATE / 10);
  return 10 * Math.log10(frame.reduce((s, x) => s + x * x, 0) / frame.length);
}

describe("the cymbal", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(cymbal.type);
  });

  test("places hits on its own grid from timeline 0, thinned at its density, at seeded times", () => {
    const genome = oneCymbal();
    const voice = firstVoice(genome);
    // Candidates every 2 s, each firing with probability 4 × 2 / 60.
    const expected = Array.from({ length: 300 }, (_, k) => k).filter((k) =>
      fires(7, voice.id, k, (4 * STEP) / 60),
    );
    const hits = cymbalHits(genome, voice, 7, RATE, 0, 600);
    expect(hits.map((h) => h.index)).toEqual(expected);
    for (const hit of hits) {
      expect(hit.frame / RATE).toBeGreaterThanOrEqual(hit.index * STEP);
      expect(hit.frame / RATE).toBeLessThanOrEqual((hit.index + 0.5) * STEP);
    }
    // Another seed fires other candidates at other times.
    const other = cymbalHits(genome, voice, 8, RATE, 0, 600);
    expect(other.map((h) => h.frame)).not.toEqual(hits.map((h) => h.frame));
    // 4 a minute for 10 minutes, over 50 seeds: the mean's standard error is about 0.8.
    const seeds = Array.from({ length: 50 }, (_, s) => s);
    const mean =
      seeds.reduce((sum, seed) => sum + cymbalHits(genome, voice, seed, RATE, 0, 600).length, 0) /
      seeds.length;
    expect(mean).toBeGreaterThan(40 - 4);
    expect(mean).toBeLessThan(40 + 4);
  });

  test("keeps every hit when its density rises, at the same times", () => {
    const sparse = oneCymbal({ density: 4 });
    const dense = oneCymbal({ density: 12 });
    const before = cymbalHits(sparse, firstVoice(sparse), 3, RATE, 0, 300);
    const after = cymbalHits(dense, firstVoice(dense), 3, RATE, 0, 300);
    expect(after.length).toBeGreaterThan(before.length);
    const frames = new Set(after.map((h) => h.frame));
    for (const hit of before) expect(frames.has(hit.frame)).toBe(true);
  });

  test("never sounds more than six hits at once, cutting the oldest", () => {
    const genome = oneCymbal({ density: cymbal.params.density.max, decay: 12 });
    const voice = firstVoice(genome);
    const hits = cymbalHits(genome, voice, 2, RATE, 0, 300);
    for (const { frame } of hits) {
      expect(hits.filter((h) => h.frame <= frame && frame < h.end).length).toBeLessThanOrEqual(6);
    }
    const cut = hits.filter((h) => h.cut && h.frame < 280 * RATE);
    expect(cut.length).toBeGreaterThan(0);
    for (const hit of cut) expect(hits.filter((h) => h.frame > hit.frame)[5]?.frame).toBe(hit.end);
  });

  test("a hit rings its decay, most of its energy above 2 kHz", () => {
    for (const decay of [2, 6, 12]) {
      const settings = settingsOf(oneCymbal({ decay, shimmer: 0 }));
      for (let index = 0; index < 4; index++) {
        const { samples } = cymbalHit(settings, 1, "cymbal", index, RATE);
        expect(samples.length).toBe(Math.ceil(decay * RATE));
        expect(Math.abs(samples[0] ?? 1)).toBe(0);
        expect(Math.abs(samples.at(-1) ?? 1)).toBe(0);
        // A 60 dB fall over the decay is 30 dB over its middle half.
        const fall = levelAt(samples, decay / 4) - levelAt(samples, (3 * decay) / 4);
        expect(fall).toBeGreaterThan(30 - 3);
        expect(fall).toBeLessThan(30 + 3);
        expect(shareAbove(samples, 2000)).toBeGreaterThan(0.5);
      }
    }
  });

  test("its brightest and darkest centers keep most of the energy above 2 kHz", () => {
    for (const center of [cymbal.params.center.min, cymbal.params.center.max]) {
      const { samples } = cymbalHit(settingsOf(oneCymbal({ center })), 1, "cymbal", 0, RATE);
      expect(shareAbove(samples, 2000)).toBeGreaterThan(0.5);
    }
  });

  test("shimmer moves a hit's level over its ring", () => {
    /** @param {number} shimmer */
    const roughness = (shimmer) => {
      const settings = settingsOf(oneCymbal({ decay: 6, shimmer }));
      const { samples } = cymbalHit(settings, 1, "cymbal", 0, RATE);
      // The spread of 50 ms levels about the straight fall of the decay, from 1 s to 4 s.
      const levels = Array.from({ length: 60 }, (_, i) => {
        const from = Math.round((1 + i * 0.05) * RATE);
        const frame = samples.subarray(from, from + RATE / 20);
        return 10 * Math.log10(frame.reduce((s, x) => s + x * x, 0) / frame.length) + i * 0.5;
      });
      const mean = levels.reduce((s, l) => s + l, 0) / levels.length;
      return Math.sqrt(levels.reduce((s, l) => s + (l - mean) ** 2, 0) / levels.length);
    };
    expect(roughness(1)).toBeGreaterThan(roughness(0) + 1);
  });

  test("validates every parameter's range, and which may be trajectories", () => {
    /** @param {Record<string, unknown>} change */
    const errors = (change) => {
      const result = validateGenome({ voices: [{ id: "cymbal", type: "cymbal", ...change }] });
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    expect(errors({})).toEqual([]);
    for (const [name, descriptor] of Object.entries(cymbal.params)) {
      const path = `$.voices[0].${name}`;
      expect(errors({ [name]: descriptor.min - 1 }), `${name} below`).toEqual([path]);
      expect(errors({ [name]: descriptor.max + 1 }), `${name} above`).toEqual([path]);
      const trajectory = {
        points: [
          [0, descriptor.default],
          [10, descriptor.default],
        ],
      };
      expect(errors({ [name]: trajectory }).length, `${name} as a trajectory`).toBe(
        descriptor.trajectory ? 0 : 1,
      );
    }
    expect(Object.keys(cymbal.params).sort()).toEqual(["center", "decay", "density", "shimmer"]);
    expect(cymbal.params.density.default).toBe(4);
    expect(cymbal.params.decay.max).toBe(12);
  });

  test("costs its slots, a buffer source and a gain a hit, and its JS, at its highest density", () => {
    const genome = oneCymbal({
      density: {
        points: [
          [0, 2],
          [30, 10, "linear"],
        ],
      },
      decay: 6,
    });
    const voice = firstVoice(genome);
    const nodes = 6 + eventCost({ rate: 10 / 60, seconds: 6, nodes: 2 });
    expect(cymbal.cost(voice, genome)).toBeGreaterThan(nodes);
    const pushed = { ...genome, macros: { ...genome.macros, density: 1 } };
    expect(cymbal.cost(voice, pushed)).toBeGreaterThan(cymbal.cost(voice, genome));
  });

  // Beside the longest reverb (20 s) the densest cymbal is over the budget, as the densest chant
  // and cloud are, and `randomGenome` redraws such genomes (decision 0071).
  test("costs at most the budget at its densest, beside an 18 s reverb", () => {
    const densest = requireGenome(
      {
        reverbDecay: 18,
        macros: { density: 1 },
        voices: [
          {
            id: "cymbal",
            type: "cymbal",
            density: cymbal.params.density.max,
            decay: cymbal.params.decay.max,
          },
        ],
      },
      "the densest cymbal",
    );
    expect(cost(densest)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("the golden genome has a trajectory and non-neutral macros, and plays in both windows", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([cymbal.type]);
    expect(golden.voices[0]?.density).toHaveProperty("points");
    expect(golden.macros.density).not.toBe(0.5);
    expect(golden.macros.brightness).not.toBe(0.5);
    const voice = firstVoice(golden);
    expect(cymbalHits(golden, voice, 1, RATE, 0, 2).length).toBeGreaterThan(0);
    // A hit that starts before the end window rings into it.
    const decay = /** @type {number} */ (voice.decay);
    expect(cymbalHits(golden, voice, 1, RATE, 58 - decay, 58).some((h) => h.end > 58 * RATE)).toBe(
      true,
    );
  });

  test("renders the same in suspend windows as up front", async () => {
    const genome = oneCymbal({ density: 20, decay: 3 });
    const windowed = await renderOffline(genome, { seed: 1, duration: 7 });
    const upFront = await renderUpFront(genome, { seed: 1, duration: 7 });
    expect(rms(windowed)).toBeGreaterThan(1e-3);
    expect(upFront.channels).toEqual(windowed.channels);
  });

  test("an excerpt matches the full render where a hit rings into it from an earlier window", async () => {
    // Pre-roll 1 s of reverb + 4 s of ring: the excerpt at 9 s renders from about 4 s.
    const genome = oneCymbal({ density: 20, decay: 4 });
    const voice = firstVoice(genome);
    const ringing = cymbalHits(genome, voice, 1, RATE, 5, 8).filter((h) => h.end > 9 * RATE);
    expect(ringing.length).toBeGreaterThan(0);
    await expectExcerptMatches(genome, { seed: 1, full: 12, offset: 9, length: 2.5 });
  });
});

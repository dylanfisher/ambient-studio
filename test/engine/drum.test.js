// The drum (decision 0071). Hits are checked from the voice's JS directly, which is cheap;
// renders are short to keep the gate light on a machine that also serves omlx.
/** @import { Genome, Voice } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { fft } from "../../src/domain/fft.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { eventCost } from "../../src/engine/cost-unit.js";
import { drum, drumHit, drumHits } from "../../src/engine/drum.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import drumGenome from "../../src/engine/genomes/drum.json" with { type: "json" };
import { resolvePitch } from "../../src/engine/pitch.js";
import { fires } from "../../src/engine/prng.js";
import { getTuning } from "../../src/engine/tuning-registry.js";
import { requireGenome, validateGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { expectExcerptMatches, renderUpFront, rms } from "../support/compare-renders.js";

const RATE = 48000;
const golden = requireGenome(drumGenome, "the drum golden genome");
/** Candidates every 0.5 s, each starting up to half a step late. */
const STEP = 0.5;
const aMinor = resolvePitch(getTuning("12-tet"), "aeolian", 9);

/**
 * A genome with one drum of fixed density in A minor, neutral macros, a short reverb, and
 * `change` on the voice.
 * @param {Record<string, unknown>} change
 */
const oneDrum = (change = {}) =>
  requireGenome(
    {
      reverbDecay: 1,
      delayFeedback: 0,
      voices: [{ id: "drum", type: "drum", density: 4, ...change }],
    },
    "one drum",
  );

/** @param {Genome} genome */
const firstVoice = (genome) => /** @type {Voice} */ (genome.voices[0]);

/**
 * The voice's effective values at 0 s, as a hit reads them.
 * @param {Genome} genome
 */
const settingsOf = (genome) => /** @type {any} */ (effectiveParams(genome, 0).voices[0]);

/**
 * The power spectrum of `samples`, from one FFT of the whole, zero-padded, with the Hz of a bin.
 * @param {ArrayLike<number>} samples
 */
function spectrum(samples) {
  let size = 1;
  while (size < samples.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < samples.length; i++) re[i] = samples[i] ?? 0;
  fft(re, im);
  const power = Float64Array.from(
    { length: size / 2 + 1 },
    (_, k) => (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2,
  );
  return { power, hz: (/** @type {number} */ k) => (k * RATE) / size };
}

/**
 * The share of `samples`' energy below `cutoff` Hz.
 * @param {ArrayLike<number>} samples
 * @param {number} cutoff
 */
function shareBelow(samples, cutoff) {
  const { power, hz } = spectrum(samples);
  let below = 0;
  let total = 0;
  for (const [k, p] of power.entries()) {
    total += p;
    if (hz(k) < cutoff) below += p;
  }
  return below / total;
}

/**
 * The frequency of the strongest bin in the `seconds` of `samples` from `from`.
 * @param {Float32Array} samples
 * @param {number} from seconds
 * @param {number} seconds
 */
function peakHz(samples, from, seconds) {
  const { power, hz } = spectrum(
    samples.subarray(Math.round(from * RATE), Math.round((from + seconds) * RATE)),
  );
  let best = 0;
  for (const [k, p] of power.entries()) if (p > (power[best] ?? 0)) best = k;
  return hz(best);
}

describe("the drum", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(drum.type);
  });

  test("places hits on its own grid from timeline 0, thinned at its density, at seeded times", () => {
    const genome = oneDrum();
    const voice = firstVoice(genome);
    // Candidates every 0.5 s, each firing with probability 4 × 0.5 / 60.
    const expected = Array.from({ length: 1200 }, (_, k) => k).filter((k) =>
      fires(7, voice.id, k, (4 * STEP) / 60),
    );
    const hits = drumHits(genome, voice, 7, RATE, 0, 600);
    expect(hits.map((h) => h.index)).toEqual(expected);
    for (const hit of hits) {
      expect(hit.frame / RATE).toBeGreaterThanOrEqual(hit.index * STEP);
      expect(hit.frame / RATE).toBeLessThanOrEqual((hit.index + 0.5) * STEP);
    }
    const other = drumHits(genome, voice, 8, RATE, 0, 600);
    expect(other.map((h) => h.frame)).not.toEqual(hits.map((h) => h.frame));
    // 4 a minute for 10 minutes, over 50 seeds: the mean's standard error is about 0.9.
    const seeds = Array.from({ length: 50 }, (_, s) => s);
    const mean =
      seeds.reduce((sum, seed) => sum + drumHits(genome, voice, seed, RATE, 0, 600).length, 0) /
      seeds.length;
    expect(mean).toBeGreaterThan(40 - 4);
    expect(mean).toBeLessThan(40 + 4);
  });

  test("keeps every hit when its density rises, at the same times", () => {
    const sparse = oneDrum({ density: 4 });
    const dense = oneDrum({
      density: {
        points: [
          [0, 6],
          [300, 30, "linear"],
        ],
      },
    });
    const before = drumHits(sparse, firstVoice(sparse), 3, RATE, 0, 300);
    const after = drumHits(dense, firstVoice(dense), 3, RATE, 0, 300);
    expect(after.length).toBeGreaterThan(before.length);
    const frames = new Set(after.map((h) => h.frame));
    for (const hit of before) expect(frames.has(hit.frame)).toBe(true);
  });

  test("never sounds more than three hits at once, cutting the oldest", () => {
    const genome = oneDrum({ density: drum.params.density.max, decay: drum.params.decay.max });
    const voice = firstVoice(genome);
    const hits = drumHits(genome, voice, 2, RATE, 0, 600);
    for (const { frame } of hits) {
      expect(hits.filter((h) => h.frame <= frame && frame < h.end).length).toBeLessThanOrEqual(3);
    }
    const cut = hits.filter((h) => h.cut && h.frame < 590 * RATE);
    expect(cut.length).toBeGreaterThan(0);
    for (const hit of cut) expect(hits.filter((h) => h.frame > hit.frame)[2]?.frame).toBe(hit.end);
  });

  test("a hit is low, most of its energy under 200 Hz, its pitch falling to the scale note", () => {
    for (const decay of [0.2, 0.6, 1.5]) {
      const settings = settingsOf(oneDrum({ decay }));
      for (let index = 0; index < 4; index++) {
        const { samples } = drumHit(aMinor, settings, 1, "drum", index, RATE);
        expect(samples.length).toBe(Math.ceil(decay * RATE));
        expect(Math.abs(samples[0] ?? 1)).toBe(0);
        expect(Math.abs(samples.at(-1) ?? 1)).toBe(0);
        expect(shareBelow(samples, 200)).toBeGreaterThan(0.5);
      }
    }
    // The default 55 Hz root is A1; the strike starts an octave above it and falls quickly.
    const settings = settingsOf(oneDrum({ decay: 1.5, detune: 0 }));
    const { samples } = drumHit(aMinor, settings, 1, "drum", 0, RATE);
    expect(peakHz(samples, 0.3, 1)).toBeCloseTo(55, -1);
    expect(peakHz(samples, 0, 0.02)).toBeGreaterThan(80);
  });

  test("validates every parameter's range, and which may be trajectories", () => {
    /** @param {Record<string, unknown>} change */
    const errors = (change) => {
      const result = validateGenome({ voices: [{ id: "drum", type: "drum", ...change }] });
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    expect(errors({})).toEqual([]);
    for (const [name, descriptor] of Object.entries(drum.params)) {
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
    expect(Object.keys(drum.params).sort()).toEqual(["decay", "density", "drop", "root"]);
    expect(drum.params.density.default).toBe(4);
  });

  test("costs its slots, a buffer source and a gain a hit, and its JS, at its highest density", () => {
    const genome = oneDrum({
      density: {
        points: [
          [0, 2],
          [30, 20, "linear"],
        ],
      },
      decay: 1,
    });
    const voice = firstVoice(genome);
    expect(drum.cost(voice, genome)).toBeGreaterThan(
      3 + eventCost({ rate: 20 / 60, seconds: 1, nodes: 2 }),
    );
    const pushed = { ...genome, macros: { ...genome.macros, density: 1 } };
    expect(drum.cost(voice, pushed)).toBeGreaterThan(drum.cost(voice, genome));
  });

  test("costs at most the budget at its densest, beside the longest reverb", () => {
    const densest = requireGenome(
      {
        reverbDecay: GLOBAL_PARAMS.reverbDecay.max,
        macros: { density: 1 },
        voices: [
          {
            id: "drum",
            type: "drum",
            density: drum.params.density.max,
            decay: drum.params.decay.max,
          },
        ],
      },
      "the densest drum",
    );
    expect(cost(densest)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("the golden genome has a trajectory and non-neutral macros, and plays in both windows", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([drum.type]);
    expect(golden.voices[0]?.density).toHaveProperty("points");
    expect(golden.macros.density).not.toBe(0.5);
    expect(golden.macros.brightness).not.toBe(0.5);
    const voice = firstVoice(golden);
    expect(drumHits(golden, voice, 1, RATE, 0, 2).length).toBeGreaterThan(0);
    expect(drumHits(golden, voice, 1, RATE, 57, 60).some((h) => h.end > 58 * RATE)).toBe(true);
  });

  test("renders the same in suspend windows as up front", async () => {
    const genome = oneDrum({ density: 30, decay: 1 });
    const windowed = await renderOffline(genome, { seed: 1, duration: 7 });
    const upFront = await renderUpFront(genome, { seed: 1, duration: 7 });
    expect(rms(windowed)).toBeGreaterThan(1e-3);
    expect(upFront.channels).toEqual(windowed.channels);
  });

  test("an excerpt matches the full render where a hit rings into it from an earlier window", async () => {
    // Pre-roll 1 s of reverb + 1.5 s of ring: the excerpt at 8.3 s renders from about 5.8 s.
    const genome = oneDrum({ density: 40, decay: 1.5 });
    const voice = firstVoice(genome);
    const ringing = drumHits(genome, voice, 1, RATE, 6.5, 8).filter((h) => h.end > 8.3 * RATE);
    expect(ringing.length).toBeGreaterThan(0);
    await expectExcerptMatches(genome, { seed: 1, full: 11, offset: 8.3, length: 2.5 });
  });
});

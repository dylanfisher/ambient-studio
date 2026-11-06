/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { bell, bellNote, bellNotes, bellPartials } from "../../src/engine/bell.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { eventCost } from "../../src/engine/cost-unit.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import bellGenome from "../../src/engine/genomes/bell.json" with { type: "json" };
import { masterBusCost } from "../../src/engine/master-bus.js";
import { resolvePitch, tuningFrequencies } from "../../src/engine/pitch.js";
import { fires } from "../../src/engine/prng.js";
import { getTuning } from "../../src/engine/tuning-registry.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { expectExcerptMatches, renderUpFront, rms } from "../support/compare-renders.js";
import { renderOffline } from "../support/render-offline.js";

const RATE = 48000;
const golden = requireGenome(bellGenome, "the bell golden genome");
const [goldenBell] = bellGenome.voices;
const core18 = resolvePitch(getTuning("colundi"), "core18");
const aMinor = resolvePitch(getTuning("12-tet"), "aeolian", 9);

/**
 * A genome with one bell voice of fixed density, neutral macros, and `changes` on the voice.
 * @param {Record<string, unknown>} changes
 */
const withBell = (changes) =>
  requireGenome(
    { ...bellGenome, macros: {}, voices: [{ ...goldenBell, density: 8, ...changes }] },
    "a bell genome",
  );

/** @param {Genome} genome */
const firstVoice = (genome) => /** @type {Genome["voices"][number]} */ (genome.voices[0]);

describe("the bell", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(bell.type);
  });

  test("tuning-drawn partials are all members of the scale, up to 3 kHz", () => {
    const members = tuningFrequencies(core18, 1, 20000);
    for (const fundamental of tuningFrequencies(core18, 150, 1100)) {
      for (let index = 0; index < 30; index++) {
        const settings = { partials: 10, fall: 4, decay: 6, ratios: /** @type {const} */ ("bar") };
        const partials = bellPartials(core18, fundamental, settings, 3, "bell", index);
        expect(partials[0]?.hz).toBe(fundamental);
        for (const { hz } of partials) {
          expect(members).toContain(hz);
          expect(hz).toBeLessThanOrEqual(3000);
        }
        expect(new Set(partials.map((p) => p.hz)).size).toBe(partials.length);
      }
    }
  });

  test("in a relative tuning, partials follow the ratio table up to 3 kHz", () => {
    const settings = { partials: 6, fall: 4, decay: 6, ratios: /** @type {const} */ ("bar") };
    const partials = bellPartials(aMinor, 220, settings, 1, "bell", 0);
    expect(partials.map((p) => p.hz)).toEqual([1, 2.756, 5.404, 8.933, 13.344].map((r) => 220 * r));
    // Each partial is `fall` dB under the one below and rings shorter, the top one half as long.
    expect(20 * Math.log10((partials[1]?.gain ?? 0) / (partials[0]?.gain ?? 1))).toBeCloseTo(-4, 9);
    expect(partials.map((p) => p.t60)).toEqual(
      [...partials.map((p) => p.t60)].sort((a, b) => b - a),
    );
    expect(partials.at(-1)?.t60).toBeCloseTo(3, 9);
  });

  test("the notes over a fixed time are the candidates the seed fires, at the density on average", () => {
    const genome = withBell({});
    const voice = firstVoice(genome);
    // Candidates every 0.25 s, each firing with probability 8 / 240.
    const expected = Array.from({ length: 240 }, (_, k) => k).filter((k) =>
      fires(7, voice.id, k, (8 * 0.25) / 60),
    );
    const notes = bellNotes(genome, voice, 7, RATE, 0, 60);
    expect(notes.map((n) => n.index)).toEqual(expected);
    for (const note of notes) {
      expect(note.frame / RATE).toBeGreaterThanOrEqual(note.index * 0.25);
      expect(note.frame / RATE).toBeLessThanOrEqual((note.index + 1) * 0.25);
    }
    // 8 a minute for 10 minutes, over 50 seeds: the count's standard error is about 1.3.
    const seeds = Array.from({ length: 50 }, (_, s) => s);
    const mean =
      seeds.reduce((sum, seed) => sum + bellNotes(genome, voice, seed, RATE, 0, 600).length, 0) /
      seeds.length;
    expect(mean).toBeGreaterThan(80 - 5);
    expect(mean).toBeLessThan(80 + 5);
  });

  test("never sounds more than eight notes at once, cutting the oldest", () => {
    const genome = withBell({ density: 40, decay: 15 });
    const voice = firstVoice(genome);
    const notes = bellNotes(genome, voice, 2, RATE, 0, 140);
    for (const { frame } of notes) {
      const sounding = notes.filter((n) => n.frame <= frame && frame < n.end).length;
      expect(sounding).toBeLessThanOrEqual(8);
    }
    // Notes in the first 120 s, so the notes that cut them are all in the list.
    const cut = notes.filter((n) => n.cut && n.frame < 120 * RATE);
    expect(cut.length).toBeGreaterThan(0);
    // A cut note ends where the eighth note after it starts.
    for (const note of cut) {
      const later = notes.filter((n) => n.frame > note.frame);
      expect(later[7]?.frame).toBe(note.end);
    }
  });

  test.each(["additive", "fm", "pluck"])(
    "a %s note ramps in and out: it starts and ends at 0, inside its 2–10 ms attack",
    (model) => {
      const settings = /** @type {any} */ ({
        ...effectiveParams(withBell({ model, fall: 3, decay: 0.5, partials: 10 }), 0).voices[0],
      });
      for (let index = 0; index < 20; index++) {
        const { samples } = bellNote(core18, settings, 1, "bell", index, RATE);
        expect(Math.abs(samples[0] ?? 1)).toBe(0);
        expect(Math.abs(samples.at(-1) ?? 1)).toBe(0);
        // Fall 3 dB is the sharpest strike, a 2 ms attack: the note stays under a straight
        // line from 0 to the loudest a note gets, 0.5, over those 96 frames.
        for (let n = 0; n < 96; n++) {
          expect(Math.abs(samples[n] ?? 0)).toBeLessThanOrEqual((0.5 * n) / 96 + 1e-7);
        }
        // No step above 5% of that loudest level in the first and last quarter millisecond,
        // where a note started at full level would step by up to all of it. A pluck's strike
        // is white noise, which steps sample to sample by design, so only the line above
        // bounds its start.
        const edge = 12;
        const edges = model === "pluck" ? [samples.length - edge] : [1, samples.length - edge];
        for (const from of edges) {
          for (let n = from; n < from + edge; n++) {
            const step = Math.abs((samples[n] ?? 0) - (samples[n - 1] ?? 0));
            expect(step).toBeLessThanOrEqual(0.05 * 0.5);
          }
        }
      }
    },
  );

  test("costs a buffer source and a gain per note at the highest density it reaches", () => {
    const genome = withBell({
      density: {
        points: [
          [0, 2],
          [30, 20, "linear"],
        ],
      },
      decay: 6,
    });
    const voice = firstVoice(genome);
    expect(bell.cost(voice, genome)).toBeCloseTo(
      eventCost({ rate: 20 / 60, seconds: 6, nodes: 2 }),
      9,
    );
    // The density macro at 1 moves 20 a minute up a quarter of the range's octaves.
    const pushed = { ...genome, macros: { ...genome.macros, density: 1 } };
    expect(bell.cost(voice, pushed)).toBeGreaterThan(bell.cost(voice, genome));
  });

  test("costs at most the budget at its densest, beside the longest reverb", () => {
    const densest = requireGenome(
      {
        ...bellGenome,
        reverbDecay: GLOBAL_PARAMS.reverbDecay.max,
        macros: { density: 1 },
        voices: [{ ...goldenBell, density: bell.params.density.max, decay: bell.params.decay.max }],
      },
      "the densest bell",
    );
    const voice = firstVoice(densest);
    expect(bell.cost(voice, densest)).toBeCloseTo(
      eventCost({ rate: 40 / 60, seconds: 15, nodes: 2 }),
      9,
    );
    expect(cost(densest)).toBeLessThanOrEqual(COST_BUDGET);
    expect(cost(densest) - masterBusCost(densest)).toBeCloseTo(2 + 28, 9);
  });

  test("the golden genome uses Colundi's core18, a trajectory and a non-neutral macro", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([bell.type]);
    expect([golden.tuning, golden.scale]).toEqual(["colundi", "core18"]);
    expect(golden.voices[0]?.density).toHaveProperty("points");
    expect(golden.macros.density).not.toBe(0.5);
    const neutral = { ...golden, macros: { ...golden.macros, density: 0.5 } };
    expect(effectiveParams(golden, 2).voices[0]?.density).toBeGreaterThan(
      /** @type {number} */ (effectiveParams(neutral, 2).voices[0]?.density),
    );
    // It plays in both golden windows.
    const voice = firstVoice(golden);
    expect(bellNotes(golden, voice, 1, RATE, 0, 2).length).toBeGreaterThan(0);
    expect(bellNotes(golden, voice, 1, RATE, 52, 58).length).toBeGreaterThan(0);
  });

  test.each(["additive", "fm", "pluck"])(
    "renders %s notes the same in suspend windows as up front",
    async (model) => {
      const genome = withBell({ model, density: 40, decay: 2 });
      const windowed = await renderOffline(genome, { seed: 1, duration: 7 });
      const upFront = await renderUpFront(genome, { seed: 1, duration: 7 });
      expect(rms(windowed)).toBeGreaterThan(1e-3);
      expect(upFront.channels).toEqual(windowed.channels);
    },
  );

  test("an excerpt matches the same window of a longer render (0007's tolerance)", async () => {
    // Pre-roll 1 s of reverb + 2 s of ring: the excerpt at 9 s renders from about 6 s.
    const genome = requireGenome(
      { ...withBell({ density: 40, decay: 2, partials: 10 }), reverbDecay: 1, delayFeedback: 0 },
      "a bell with a short pre-roll",
    );
    const { excerpt } = await expectExcerptMatches(genome, {
      seed: 1,
      full: 12,
      offset: 9,
      length: 2.5,
    });
    expect(rms(excerpt)).toBeGreaterThan(1e-3);
  });

  test("an excerpt matches where the cap cuts notes", async () => {
    // Pre-roll 1 s of reverb + 15 s of ring: the excerpt at 18 s renders from about 2 s.
    const genome = requireGenome(
      { ...withBell({ density: 40, decay: 15 }), reverbDecay: 1, delayFeedback: 0 },
      "a dense bell",
    );
    const voice = firstVoice(genome);
    expect(bellNotes(genome, voice, 1, RATE, 2, 22).filter((n) => n.cut).length).toBeGreaterThan(2);
    await expectExcerptMatches(genome, { seed: 1, full: 22, offset: 18, length: 4 });
  });

  test("plays notes only from its start to its end, and an excerpt across them matches", async () => {
    const genome = requireGenome(
      {
        ...withBell({ density: 40, decay: 2, start: 3.3, end: 6.1 }),
        reverbDecay: 1,
        delayFeedback: 0,
      },
      "a bell that starts and ends inside the render",
    );
    const voice = firstVoice(genome);
    const notes = bellNotes(genome, voice, 1, RATE, 0, 10);
    expect(notes.length).toBeGreaterThan(0);
    for (const { frame } of notes) {
      expect(frame).toBeGreaterThanOrEqual(3.3 * RATE);
      expect(frame).toBeLessThan(6.1 * RATE);
    }
    const result = await renderOffline(genome, { seed: 1, duration: 10 });
    const before = result.channels.map((c) => c.subarray(0, Math.floor(3.3 * RATE)));
    expect(before.every((c) => c.every((x) => x === 0))).toBe(true);
    expect(rms(result)).toBeGreaterThan(1e-3);
    // The excerpt's pre-roll (3 s) starts before the voice does; the voice ends inside it.
    await expectExcerptMatches(genome, { seed: 1, full: 10, offset: 5, length: 2.5 });
  });

  test("renders harmonic ratios in a relative tuning, windowed, up front and as an excerpt", async () => {
    const genome = requireGenome(
      {
        ...withBell({ density: 40, decay: 2, partials: 10, ratios: "harmonic" }),
        tuning: "12-tet",
        scale: "aeolian",
        key: 9,
        reverbDecay: 1,
        delayFeedback: 0,
      },
      "a bell with harmonic ratios",
    );
    const windowed = await renderOffline(genome, { seed: 1, duration: 7 });
    const upFront = await renderUpFront(genome, { seed: 1, duration: 7 });
    expect(rms(windowed)).toBeGreaterThan(1e-3);
    expect(upFront.channels).toEqual(windowed.channels);
    const bar = requireGenome(
      { ...genome, voices: [{ ...firstVoice(genome), ratios: "bar" }] },
      "the same bell with bar ratios",
    );
    const barRender = await renderOffline(bar, { seed: 1, duration: 7 });
    expect(barRender.channels[0]).not.toEqual(windowed.channels[0]);
    await expectExcerptMatches(genome, { seed: 1, full: 12, offset: 9, length: 2.5 });
  });
});

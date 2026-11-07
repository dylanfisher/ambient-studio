/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, test } from "vitest";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import padGenome from "../../src/engine/genomes/pad.json" with { type: "json" };
import { pad, padChord, padEnvelope } from "../../src/engine/pad.js";
import { resolvePitch, tuningFrequencies } from "../../src/engine/pitch.js";
import { preRoll } from "../../src/engine/render-plan.js";
import { getTuning } from "../../src/engine/tuning-registry.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { expectExcerptMatches, renderUpFront, rms } from "../support/compare-renders.js";

const RATE = 48000;
const golden = requireGenome(padGenome, "the pad golden genome");
const [goldenPad] = padGenome.voices;

/** @param {Genome} genome */
const firstVoice = (genome) => /** @type {Genome["voices"][number]} */ (genome.voices[0]);

/**
 * The voice's own output, without the bus: its `build` on a bare context, every parameter held
 * at its value at timeline 0, and only the windows given.
 * @param {Genome} genome
 * @param {number} seconds
 * @param {[number, number][]} windows
 */
async function renderDry(genome, seconds, windows) {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: seconds * RATE,
    sampleRate: RATE,
  });
  const voice = firstVoice(genome);
  const play = pad.build({
    ctx,
    output: ctx.destination,
    genome,
    voice,
    seed: 1,
    from: 0,
    to: seconds,
    startFrame: 0,
    samples: {},
    at: (time) => time,
    automate: (param, value) => {
      param.value = value(/** @type {any} */ (effectiveParams(genome, 0).voices[0]), 0);
    },
  });
  for (const [from, to] of windows) play?.(from, to);
  const buffer = await ctx.startRendering();
  return /** @type {Float32Array} */ (buffer.getChannelData(0));
}

/**
 * The largest step between neighboring samples from `from` to `to` seconds.
 * @param {Float32Array} samples
 * @param {number} from
 * @param {number} to
 */
function largestStep(samples, from, to) {
  let step = 0;
  for (let i = Math.max(1, Math.round(from * RATE)); i < Math.round(to * RATE); i++) {
    step = Math.max(step, Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0)));
  }
  return step;
}

describe("the pad", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(pad.type);
  });

  test.each([
    ["12-tet", "aeolian", 9],
    ["12-tet", "minor-pentatonic", 2],
    ["19-edo", "all", 0],
    ["colundi", "core18", undefined],
    ["colundi", "subset38", undefined],
  ])("chord notes in %s %s are all in the scale, 100 to 500 Hz", (tuning, scale, key) => {
    const pitch = resolvePitch(getTuning(tuning), scale, key);
    const allowed = tuningFrequencies(pitch, 100, 500);
    for (const notes of [3, 5, 7]) {
      for (let index = 0; index < 40; index++) {
        const chord = padChord(pitch, notes, 7, "pad", index);
        expect(chord.length).toBe(Math.min(notes, allowed.length));
        for (const hz of chord) expect(allowed).toContain(hz);
        expect(new Set(chord).size).toBe(chord.length);
      }
    }
  });

  test("a seven-note scale stacks thirds", () => {
    const pitch = resolvePitch(getTuning("12-tet"), "aeolian", 9);
    const allowed = tuningFrequencies(pitch, 100, 500);
    const chord = padChord(pitch, 4, 3, "pad", 0);
    const steps = chord
      .slice(1)
      .map((hz, j) => allowed.indexOf(hz) - allowed.indexOf(chord[j] ?? 0));
    expect(steps).toEqual([2, 2, 2]);
  });

  test("the envelope rises, decays to the sustain, holds and releases to 0", () => {
    expect(padEnvelope(8, 30, 12)).toEqual([
      [0, 0],
      [8, 1],
      [12, 0.7],
      [30, 0.7],
      [42, 0],
    ]);
    // A chord that ends during its attack releases from where the gain got to.
    expect(padEnvelope(20, 10, 4)).toEqual([
      [0, 0],
      [10, 0.5],
      [14, 0],
    ]);
  });

  test("a note ramps in and out: no step above 1e-4 within 5 ms of its start or end", async () => {
    // One chord alone: hold 20, release 4, so its notes stop at 24 s.
    const genome = requireGenome(
      {
        ...padGenome,
        voices: [{ ...goldenPad, notes: 3, hold: 20, attack: 2, release: 4, swing: 0 }],
      },
      "a pad with one chord",
    );
    const samples = await renderDry(genome, 25, [[0, 2]]);
    expect(largestStep(samples, 0, 0.005)).toBeLessThan(1e-4);
    expect(largestStep(samples, 23.995, 24.005)).toBeLessThan(1e-4);
    expect(largestStep(samples, 24.005, 25)).toBe(0);
    // The chord itself sounds and moves, so the bound above means something.
    expect(largestStep(samples, 5, 15)).toBeGreaterThan(1e-3);
  });

  test("costs at most the budget at its densest, beside the longest reverb", () => {
    const { min: hold } = pad.params.hold;
    const densest = requireGenome(
      {
        ...padGenome,
        reverbDecay: GLOBAL_PARAMS.reverbDecay.max,
        voices: [
          { ...goldenPad, notes: pad.params.notes.max, hold, release: pad.params.release.max },
        ],
      },
      "the densest pad",
    );
    expect(cost(densest)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("the golden genome uses a trajectory and a non-neutral macro", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([pad.type]);
    expect(golden.voices[0]?.tone).toHaveProperty("points");
    expect(golden.macros.brightness).not.toBe(0.5);
    // Brightness is mapped onto the tone, so the macro moves it.
    const neutral = { ...golden, macros: { ...golden.macros, brightness: 0.5 } };
    expect(effectiveParams(golden, 2).voices[0]?.tone).not.toBe(
      effectiveParams(neutral, 2).voices[0]?.tone,
    );
  });

  test("renders the same samples in suspend windows as up front", async () => {
    const windowed = await renderOffline(golden, { seed: 1, duration: 5 });
    const upFront = await renderUpFront(golden, { seed: 1, duration: 5 });
    expect(rms(windowed)).toBeGreaterThan(1e-3);
    expect(upFront.channels).toEqual(windowed.channels);
  });

  // A 1 s reverb and no echo, so the pre-roll is 1 s and the chords sounding at the excerpt's
  // start start there with the phase and gain they have reached. Chord 0 rises over 0-2 s,
  // decays to 3 s, holds to 20 s and releases to 24 s; chord 1 does the same from 20 s.
  /** @param {Record<string, unknown>} [changes] on the voice */
  const shortPreRoll = (changes = {}) =>
    requireGenome(
      {
        ...padGenome,
        reverbDecay: 1,
        delayFeedback: 0,
        voices: [{ ...goldenPad, hold: 20, attack: 2, release: 4, ...changes }],
      },
      "a pad with a short pre-roll",
    );

  test("adds no pre-roll for its chords: an excerpt's is the reverb's alone", () => {
    expect(preRoll(shortPreRoll(), 27)).toBe(1);
  });

  test.each([
    ["one chord in its sustain", 27],
    ["one chord in its release and the next in its attack", 21],
    ["one chord in its release and the next in its decay", 22.5],
  ])(
    "an excerpt matches its window of a longer render with %s (0007's tolerance)",
    async (_, offset) => {
      const { excerpt } = await expectExcerptMatches(shortPreRoll(), {
        seed: 1,
        full: 30,
        offset,
        length: 2.5,
      });
      expect(rms(excerpt)).toBeGreaterThan(1e-3);
    },
  );

  test.each([
    ["starts", 12.5],
    ["ends", 25],
  ])(
    "an excerpt matches where the voice %s inside it, mid-chord (0007's tolerance)",
    async (_, offset) => {
      const genome = shortPreRoll({ start: 13, end: 26.5 });
      const { excerpt } = await expectExcerptMatches(genome, {
        seed: 1,
        full: 30,
        offset,
        length: 2.5,
      });
      expect(rms(excerpt)).toBeGreaterThan(1e-3);
    },
  );
});

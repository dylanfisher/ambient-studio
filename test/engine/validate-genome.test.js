import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { validateGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

/** @param {unknown} value */
function valid(value) {
  const result = validateGenome(value);
  if (!result.ok) throw new Error(`expected a valid genome, got ${JSON.stringify(result.errors)}`);
  return result.genome;
}

/** @param {unknown} value */
function errorsOf(value) {
  const result = validateGenome(value);
  if (result.ok) throw new Error("expected errors, got a valid genome");
  return result.errors;
}

const voice = { id: "a", type: "fixture" };

describe("validateGenome", () => {
  test("an empty genome comes back with every global default written out", () => {
    expect(valid({})).toEqual({
      schemaVersion: 1,
      duration: 300,
      tuning: "12-tet",
      scale: "aeolian",
      key: 9,
      pulse: "none",
      loudness: -16,
      ceiling: -1,
      width: -3,
      fadeIn: 4,
      fadeOut: 20,
      reverbDecay: 8,
      reverbLevel: -12,
      delayTime: 0.75,
      delayFeedback: 0.35,
      delayLevel: -24,
      macros: {
        brightness: 0.5,
        density: 0.5,
        motion: 0.5,
        space: 0.5,
        warmth: 0.5,
        tension: 0.5,
      },
      voices: [],
    });
  });

  test("a voice comes back with its common and own defaults written out", () => {
    expect(valid({ voices: [voice] }).voices).toEqual([
      {
        id: "a",
        type: "fixture",
        start: 0,
        end: 900,
        level: -12,
        detune: 3,
        cutoff: 600,
        partials: 6,
        wave: "sine",
        snap: false,
      },
    ]);
  });

  test("given values and trajectories are kept", () => {
    const cutoff = {
      points: [
        [0, 200],
        [120, 1500],
      ],
    };
    const genome = valid({
      duration: 600,
      pulse: "beat",
      bpm: 72,
      macros: { warmth: { points: [[0, 0.2]] } },
      voices: [{ ...voice, cutoff, wave: "triangle", snap: true, partials: 12 }],
    });
    expect(genome.duration).toBe(600);
    expect(genome.bpm).toBe(72);
    expect(genome.macros.warmth).toEqual({ points: [[0, 0.2]] });
    expect(genome.voices[0]).toMatchObject({ cutoff, wave: "triangle", snap: true, partials: 12 });
  });

  test("validating a normalized genome returns it unchanged, and the input isn't mutated", () => {
    const input = { tuning: "colundi", scale: "core18", voices: [voice] };
    const snapshot = structuredClone(input);
    const normalized = valid(input);
    expect(input).toEqual(snapshot);
    expect(valid(normalized)).toEqual(normalized);
    expect(valid(structuredClone(normalized))).toEqual(normalized);
  });

  /** @type {[string, Record<string, unknown>, string, RegExp][]} */
  const rules = [
    ["a number below its range", { duration: 30 }, "$.duration", /from 60 to 900 s, got 30/],
    ["a number above its range", { loudness: -3 }, "$.loudness", /from -30 to -9 LUFS/],
    ["a string for a number", { width: "-3" }, "$.width", /must be a number/],
    ["a non-finite number", { width: Number.NaN }, "$.width", /must be a number/],
    [
      "a fraction for an int",
      { voices: [{ ...voice, partials: 2.5 }] },
      "$.voices[0].partials",
      /whole number/,
    ],
    [
      "an enum value not listed",
      { voices: [{ ...voice, wave: "saw" }] },
      "$.voices[0].wave",
      /one of "sine", "triangle", got "saw"/,
    ],
    [
      "a bool given as a number",
      { voices: [{ ...voice, snap: 1 }] },
      "$.voices[0].snap",
      /true or false/,
    ],
    [
      "a trajectory where none is allowed",
      { fadeIn: { points: [[0, 1]] } },
      "$.fadeIn",
      /can't be a trajectory/,
    ],
    [
      "a trajectory point out of range",
      {
        voices: [
          {
            ...voice,
            cutoff: {
              points: [
                [0, 200],
                [60, 5000],
              ],
            },
          },
        ],
      },
      "$.voices[0].cutoff.points[1][1]",
      /from 100 to 2000 Hz/,
    ],
    [
      "trajectory times that don't rise",
      {
        reverbLevel: {
          points: [
            [10, -12],
            [10, -20],
          ],
        },
      },
      "$.reverbLevel.points[1][0]",
      /rise/,
    ],
    [
      "an empty trajectory",
      { reverbLevel: { points: [] } },
      "$.reverbLevel.points",
      /at least one/,
    ],
    ["a macro out of range", { macros: { space: 1.5 } }, "$.macros.space", /from 0 to 1/],
    ["macros that aren't an object", { macros: [] }, "$.macros", /must be an object/],
    ["voices that aren't a list", { voices: {} }, "$.voices", /must be a list/],
    ["a voice that isn't an object", { voices: [3] }, "$.voices[0]", /must be an object/],
    ["an empty voice id", { voices: [{ ...voice, id: "" }] }, "$.voices[0].id", /\^\[a-z\]/],
    ["a missing voice id", { voices: [{ type: "fixture" }] }, "$.voices[0].id", /missing/],
    ["a duplicate voice id", { voices: [voice, voice] }, "$.voices[1].id", /"a" is already used/],
    [
      "an unknown voice type",
      { voices: [{ id: "a", type: "theremin" }] },
      "$.voices[0].type",
      /unknown voice type "theremin"; known: .*fixture/,
    ],
    [
      "a voice that ends before it starts",
      { voices: [{ ...voice, start: 60, end: 30 }] },
      "$.voices[0].end",
      /after start/,
    ],
    [
      "fades longer than the timeline",
      { duration: 60, fadeIn: 30, fadeOut: 40 },
      "$.fadeOut",
      /fadeIn \+ fadeOut/,
    ],
    ["a key outside the tuning's degrees", { key: 12 }, "$.key", /0 to 11/],
    ["a bpm without a pulse", { bpm: 80 }, "$.bpm", /only when pulse isn't "none"/],
    ["another schema version", { schemaVersion: 2 }, "$.schemaVersion", /must be 1/],
    ["an unknown tuning", { tuning: "pythagorean" }, "$.tuning", /one of .*12-tet/],
    ["a genome that isn't an object", /** @type {any} */ ([]), "$", /must be an object/],
    [
      "a bpm given with pulse none",
      { pulse: "none", bpm: 80 },
      "$.bpm",
      /only when pulse isn't "none"/,
    ],
    [
      "an unknown key inside a trajectory",
      { reverbLevel: { points: [[0, -12]], curve: "exp" } },
      "$.reverbLevel.curve",
      /unknown key/,
    ],
    [
      "more trajectory points than the cap",
      { reverbLevel: { points: Array.from({ length: 65 }, (_, i) => [i, -12]) } },
      "$.reverbLevel.points",
      /at most 64/,
    ],
    [
      "more voices than the cap",
      { voices: Array.from({ length: 17 }, (_, i) => ({ id: `v${i}`, type: "fixture" })) },
      "$.voices",
      /at most 16/,
    ],
  ];

  test("the caps themselves are allowed", () => {
    const points = Array.from({ length: 64 }, (_, i) => [i, -12]);
    const voices = Array.from({ length: 16 }, (_, i) => ({ id: `v${i}`, type: "fixture" }));
    const genome = valid({ reverbLevel: { points }, voices });
    expect(genome.voices).toHaveLength(16);
  });

  test.each(rules)("%s fails at its path", (_, genome, path, message) => {
    const errors = errorsOf(genome);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe(path);
    expect(errors[0]?.message).toMatch(message);
  });

  test("unknown keys fail at every level", () => {
    const errors = errorsOf({
      tempo: 90,
      macros: { gloom: 0.4 },
      voices: [{ ...voice, resonance: 2 }],
    });
    expect(errors.map((e) => e.path)).toEqual([
      "$.tempo",
      "$.macros.gloom",
      "$.voices[0].resonance",
    ]);
    for (const error of errors) expect(error.message).toMatch(/unknown key/);
  });

  test("every error is listed, not just the first", () => {
    const errors = errorsOf({
      duration: 5,
      width: 3,
      macros: { motion: -1 },
      voices: [{ ...voice, level: 6, wave: "square" }],
    });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "$.duration",
      "$.macros.motion",
      "$.voices[0].level",
      "$.voices[0].wave",
      "$.width",
    ]);
  });
});

describe("tuning, scale and key", () => {
  test("an absolute tuning takes no key and stores none", () => {
    const genome = valid({ tuning: "colundi", scale: "core18" });
    expect(genome).not.toHaveProperty("key");
  });

  test("a key with an absolute tuning fails", () => {
    const errors = errorsOf({ tuning: "colundi", scale: "core18", key: 0 });
    expect(errors).toEqual([
      { path: "$.key", message: expect.stringMatching(/only with a relative tuning/) },
    ]);
  });

  test("a scale not defined in the tuning fails, naming the ones it has", () => {
    const errors = errorsOf({ tuning: "colundi", scale: "dorian" });
    expect(errors).toEqual([
      {
        path: "$.scale",
        message: expect.stringMatching(/"dorian" is not a scale of colundi; it has all, .*core18/),
      },
    ]);
  });

  test("a relative tuning's key may be any of its degrees", () => {
    expect(valid({ tuning: "19-edo", scale: "all", key: 18 }).key).toBe(18);
    expect(errorsOf({ tuning: "bohlen-pierce", scale: "lambda", key: 13 })[0]?.path).toBe("$.key");
  });
});

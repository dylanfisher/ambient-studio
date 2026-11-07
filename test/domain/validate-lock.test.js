// Lock paths and values against the schema (decision 0035): every path kind round-trips, and a
// path or value the candidate's genome can't hold is refused.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { lockOn, validateLock } from "../../src/domain/validate-lock.js";
import colundiGenome from "../../src/engine/genomes/colundi.json" with { type: "json" };
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

const genome = requireGenome(exampleGenome, "example genome");

/** @param {string} path */
function taken(path, from = genome) {
  const result = lockOn(from, path);
  if (!result.ok) throw new Error(`${path}: ${result.message}`);
  return result.lock;
}

describe("validateLock", () => {
  test.each([
    ["a global number", "reverbDecay", 8],
    ["a global choice", "scale", "dorian"],
    ["a global trajectory, whole", "reverbLevel", exampleGenome.reverbLevel],
    ["a macro", "macros.space", 0.6],
    ["a voice's number", "voices.pad.hold", 30],
    ["a voice's int", "voices.drone.partials", 8],
    ["a voice's choice", "voices.air.color", "pink"],
  ])("%s round-trips: %s", (_, path, value) => {
    const lock = taken(path);
    expect(lock.value).toEqual(value);
    expect(validateLock(lock, genome)).toEqual({ ok: true, lock });
  });

  test("a voice's trajectory locks whole, every curve written out", () => {
    const lock = taken("voices.drone.cutoff");
    expect(lock).toEqual({
      path: "voices.drone.cutoff",
      value: {
        points: [
          [0, 300],
          [120, 650, "smooth"],
          [300, 400, "smooth"],
        ],
      },
      voiceType: "drone",
    });
    expect(validateLock(lock, genome)).toEqual({ ok: true, lock });
  });

  test("a whole voice round-trips with its defaults written out", () => {
    const lock = taken("voices.pad");
    expect(lock.value).toMatchObject({ id: "pad", type: "pad", hold: 30, start: 0, end: 900 });
    expect(lock).not.toHaveProperty("voiceType");
    expect(validateLock(lock, genome)).toEqual({ ok: true, lock });
  });

  test("a flag round-trips", () => {
    const withFixture = requireGenome(
      { ...exampleGenome, voices: [{ id: "fx", type: "fixture", snap: true }] },
      "fixture genome",
    );
    const lock = taken("voices.fx.snap", withFixture);
    expect(lock).toEqual({ path: "voices.fx.snap", value: true, voiceType: "fixture" });
    expect(validateLock(lock, withFixture)).toEqual({ ok: true, lock });
  });

  test("a value given in short form comes back canonical", () => {
    const short = {
      path: "voices.drone.cutoff",
      value: {
        points: [
          [0, 300],
          [300, 400],
        ],
      },
    };
    expect(validateLock({ ...short, voiceType: "drone" }, genome)).toEqual({
      ok: true,
      lock: {
        ...short,
        value: {
          points: [
            [0, 300],
            [300, 400, "linear"],
          ],
        },
        voiceType: "drone",
      },
    });
  });

  test.each([
    ["an unknown global", { path: "shimmer", value: 1 }, /names no parameter/],
    ["an unknown macro", { path: "macros.glow", value: 0.5 }, /names no parameter/],
    [
      "an unknown voice parameter",
      { path: "voices.pad.glow", value: 1, voiceType: "pad" },
      /a pad voice has no parameter "glow"/,
    ],
    [
      "a voice's id, which isn't a parameter",
      { path: "voices.pad.type", value: "pad", voiceType: "pad" },
      /a pad voice has no parameter "type"/,
    ],
    ["a trajectory's end", { path: "reverbLevel.start", value: -16 }, /names no parameter/],
    [
      "a voice the candidate lacks",
      { path: "voices.choir.level", value: -12, voiceType: "pad" },
      /the candidate has no voice "choir"/,
    ],
    [
      "a whole voice the candidate lacks",
      { path: "voices.choir", value: { id: "choir", type: "pad" } },
      /the candidate has no voice "choir"/,
    ],
    ["a global out of range", { path: "reverbDecay", value: 50 }, /must be from 1 to 20/],
    [
      "a voice's number out of range",
      { path: "voices.pad.hold", value: -1, voiceType: "pad" },
      /voices\[1\]\.hold: must be from/,
    ],
    [
      "a choice not among its values",
      { path: "voices.air.color", value: "plaid", voiceType: "noise" },
      /must be one of/,
    ],
    [
      "a voice with an invalid parameter",
      { path: "voices.pad", value: { id: "pad", type: "pad", hold: "long" } },
      /must be a number/,
    ],
    [
      "a voice under another id",
      { path: "voices.pad", value: { id: "pad2", type: "pad" } },
      /its id must be "pad"/,
    ],
    [
      "a voice parameter without its voice's type",
      { path: "voices.pad.hold", value: 30 },
      /voiceType must be "pad"/,
    ],
    [
      "a voice parameter naming another type",
      { path: "voices.pad.hold", value: 30, voiceType: "drone" },
      /voiceType must be "pad"/,
    ],
    [
      "a voice type on a global",
      { path: "reverbDecay", value: 8, voiceType: "pad" },
      /only a lock on a voice's parameter names voiceType/,
    ],
    ["no value", { path: "reverbDecay" }, /has no value/],
    ["another key", { path: "reverbDecay", value: 8, why: "x" }, /unknown keys why/],
  ])("refuses %s", (_, lock, message) => {
    const result = validateLock(lock, genome);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(message);
  });

  test("refuses a key the candidate's tuning leaves out", () => {
    const result = lockOn(requireGenome(colundiGenome, "colundi genome"), "key");
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/the candidate has no key/),
    });
  });
});

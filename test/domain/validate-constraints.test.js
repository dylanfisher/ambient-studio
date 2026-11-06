import { describe, expect, test } from "vitest";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { COST_BUDGET } from "../../src/engine/cost.js";

/** Sets every kind at once. */
const full = {
  tuning: "12-tet",
  scale: "dorian",
  key: 2,
  pulse: "beat",
  bpm: { min: 60, max: 90 },
  duration: { min: 120, max: 240 },
  loudness: -16,
  allowedVoices: ["drone", "pad", "bell"],
  bannedVoices: ["noise"],
  bellNotes: 4,
  grains: 10,
  padChords: 1.5,
  brightness: { min: 0.3, max: 0.7 },
  cost: 300,
};

/** @param {unknown} value */
function errorsOf(value) {
  const result = validateConstraints(value);
  if (result.ok) throw new Error("expected errors, got a valid constraint set");
  return result.errors;
}

describe("validateConstraints", () => {
  test("a set with every kind comes back unchanged", () => {
    expect(validateConstraints(full)).toEqual({ ok: true, constraints: full });
  });

  test("an empty set constrains nothing and is valid", () => {
    expect(validateConstraints({})).toEqual({ ok: true, constraints: {} });
  });

  /** @type {[string, unknown, string, RegExp][]} */
  const refused = [
    ["not an object", [], "$", /must be an object/],
    ["an unknown kind", { tempo: 60 }, "$.tempo", /unknown key/],
    [
      "an unknown voice type",
      { allowedVoices: ["choir"] },
      "$.allowedVoices[0]",
      /unknown voice type "choir"/,
    ],
    [
      "a banned unknown voice type",
      { bannedVoices: ["choir"] },
      "$.bannedVoices[0]",
      /unknown voice type/,
    ],
    ["an empty allowed list", { allowedVoices: [] }, "$.allowedVoices", /at least one/],
    ["a voice type listed twice", { bannedVoices: ["pad", "pad"] }, "$.bannedVoices[1]", /twice/],
    [
      "a type both allowed and banned",
      { allowedVoices: ["pad"], bannedVoices: ["pad"] },
      "$.bannedVoices",
      /also allowed/,
    ],
    [
      "a range with min above max",
      { duration: { min: 300, max: 120 } },
      "$.duration",
      /min 300.*max 120/,
    ],
    [
      "a range end outside the genome's range",
      { duration: { min: 30, max: 120 } },
      "$.duration.min",
      /from 60 to 900 s/,
    ],
    ["a range missing an end", { brightness: { min: 0.2 } }, "$.brightness.max", /missing/],
    [
      "a range with an unknown key",
      { bpm: { min: 60, max: 90, step: 1 } },
      "$.bpm.step",
      /unknown key/,
    ],
    ["a range that isn't an object", { duration: 120 }, "$.duration", /min and max/],
    ["a loudness above the genome's top", { loudness: -9 }, "$.loudness", /from -30 to -10 LUFS/],
    ["a tuning that doesn't exist", { tuning: "24-edo" }, "$.tuning", /must be one of/],
    [
      "a scale the fixed tuning lacks",
      { tuning: "19-edo", scale: "dorian" },
      "$.scale",
      /not a scale of 19-edo/,
    ],
    ["a key with an absolute tuning", { tuning: "colundi", key: 2 }, "$.key", /relative tuning/],
    ["a key past the fixed tuning's degrees", { tuning: "12-tet", key: 14 }, "$.key", /0 to 11/],
    [
      "a tempo range with no beat",
      { pulse: "none", bpm: { min: 60, max: 90 } },
      "$.bpm",
      /pulse isn.t "none"/,
    ],
    [
      "a ceiling given as a trajectory",
      { grains: { points: [[0, 4]] } },
      "$.grains",
      /give a number/,
    ],
    ["a ceiling outside its parameter's range", { bellNotes: 100 }, "$.bellNotes", /0.5 to 40/],
    [
      "a cost over the engine's budget",
      { cost: COST_BUDGET + 1 },
      "$.cost",
      new RegExp(`to ${COST_BUDGET}`),
    ],
  ];

  test.each(refused)("refuses %s", (_name, value, path, message) => {
    const errors = errorsOf(value);
    expect(errors).toContainEqual({ path, message: expect.stringMatching(message) });
  });

  test("reports every error, not only the first", () => {
    const errors = errorsOf({ tempo: 1, loudness: -9, allowedVoices: ["choir"] });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "$.allowedVoices[0]",
      "$.loudness",
      "$.tempo",
    ]);
  });
});

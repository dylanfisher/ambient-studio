import { describe, expect, test } from "vitest";
import { CONSTRAINT_KINDS, FORM } from "../../src/domain/constraint-schema.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { constraintFields, fieldValues, readConstraints } from "../../src/web/constraint-fields.js";

/**
 * Reads the form's values from a plain record, the way FormData's get and getAll would.
 * @param {Record<string, string | string[]>} values
 */
function read(values) {
  return readConstraints(
    (name) => {
      const value = values[name] ?? "";
      return Array.isArray(value) ? (value[0] ?? "") : value;
    },
    (name) => {
      const value = values[name] ?? [];
      return Array.isArray(value) ? value : [value];
    },
  );
}

describe("constraintFields", () => {
  test("has one field per constraint kind, in the table's order", () => {
    expect(constraintFields().map((field) => field.name)).toEqual(Object.keys(CONSTRAINT_KINDS));
  });

  test("a fixed name is a choice of the descriptor's values; a voice list offers every type", () => {
    const fields = Object.fromEntries(constraintFields().map((field) => [field.name, field]));
    expect(fields.pulse?.options).toEqual(["none", "beat"]);
    expect(fields.allowedVoices?.options).toEqual(voiceTypeIds());
    expect(fields.loudness).toMatchObject({ options: null, min: -30, max: -10, unit: "LUFS" });
    expect(fields.bpm).toMatchObject({ form: FORM.range, step: "1" });
    expect(fields.brightness).toMatchObject({ form: FORM.range, step: "any" });
  });
});

describe("readConstraints", () => {
  test("empty fields constrain nothing", () => {
    expect(read({})).toEqual({});
  });

  test("reads each form into the value validateConstraints takes", () => {
    const constraints = read({
      tuning: "12-tet",
      key: "2",
      pulse: "none",
      "duration.min": "120",
      "duration.max": "600",
      loudness: "-16",
      allowedVoices: ["drone", "pad"],
      bellNotes: "",
    });
    expect(constraints).toEqual({
      tuning: "12-tet",
      key: 2,
      pulse: "none",
      duration: { min: 120, max: 600 },
      loudness: -16,
      allowedVoices: ["drone", "pad"],
    });
    expect(validateConstraints(constraints).ok).toBe(true);
  });

  test("a range with one end left empty keeps the other, so the validator names the missing one", () => {
    const constraints = read({ "bpm.min": "60" });
    expect(constraints).toEqual({ bpm: { min: 60 } });
    const checked = validateConstraints(constraints);
    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.errors.map((e) => e.path)).toEqual(["$.bpm.max"]);
  });

  test("text that isn't a number is passed on as text, for the validator to refuse", () => {
    expect(read({ loudness: "loud" })).toEqual({ loudness: "loud" });
  });
});

test("fieldValues fills the form back from a stored set", () => {
  const stored = {
    scale: "dorian",
    bpm: { min: 50, max: 70 },
    bannedVoices: ["bell"],
    cost: 300,
  };
  const values = fieldValues(stored);
  expect(values).toEqual({
    scale: "dorian",
    "bpm.min": "50",
    "bpm.max": "70",
    bannedVoices: ["bell"],
    cost: "300",
  });
  expect(read(values)).toEqual(stored);
});

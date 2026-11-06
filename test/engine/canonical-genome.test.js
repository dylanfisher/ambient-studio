import { describe, expect, test } from "vitest";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import "../support/fixture-voice.js";

const a = { id: "a", type: "fixture", cutoff: 250.5 };
const b = { id: "b", type: "fixture", level: -20 };

describe("canonicalGenome", () => {
  test("ignores key order and voice order", () => {
    const one = canonicalGenome({ duration: 400, macros: { warmth: 0.25 }, voices: [a, b] });
    const two = canonicalGenome({
      voices: [
        { level: -20, type: "fixture", id: "b" },
        { cutoff: 250.5, type: "fixture", id: "a" },
      ],
      macros: { warmth: 0.25 },
      duration: 400,
    });
    expect(two).toBe(one);
  });

  test("is the normalized genome as JSON with sorted keys and voices sorted by id", () => {
    const text = canonicalGenome({ voices: [b, a] });
    const parsed = JSON.parse(text);
    expect(parsed.duration).toBe(300);
    expect(parsed.voices.map((/** @type {{id: string}} */ v) => v.id)).toEqual(["a", "b"]);
    expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort());
    expect(Object.keys(parsed.voices[0])).toEqual(Object.keys(parsed.voices[0]).sort());
    expect(text).not.toMatch(/\s/);
  });

  test("an omitted default and the same default written out give the same text", () => {
    expect(canonicalGenome({ duration: 300 })).toBe(canonicalGenome({}));
  });

  test("writes numbers in shortest round-trip form", () => {
    const text = canonicalGenome({ voices: [{ ...a, cutoff: 1e3 }], macros: { tension: 0.1 } });
    expect(text).toContain('"cutoff":1000,');
    expect(text).toContain('"tension":0.1,');
    expect(canonicalGenome({ width: -0 })).toBe(canonicalGenome({ width: 0 }));
  });

  test("throws on an invalid genome, listing its errors", () => {
    expect(() => canonicalGenome({ duration: 5 })).toThrow(/\$\.duration/);
  });
});

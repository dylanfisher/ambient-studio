import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { canonicalGenome, conciseGenome } from "../../src/engine/canonical-genome.js";
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

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

// The prompt's form of a genome (decision 0072): the schema text gives every default, so a
// value at its default says nothing the model hasn't read.
describe("conciseGenome", () => {
  test("leaves out every value at its default and keeps the rest", () => {
    const text = conciseGenome({
      duration: 300,
      width: -6,
      macros: { warmth: 0.5 },
      voices: [b, a],
    });
    expect(text).toBe(
      '{"schemaVersion":1,"voices":[{"cutoff":250.5,"id":"a","type":"fixture"},{"id":"b","level":-20,"type":"fixture"}],"width":-6}',
    );
  });

  test("validates to the same genome as the canonical form", () => {
    const concise = JSON.parse(conciseGenome(exampleGenome));
    expect(canonicalGenome(concise)).toBe(canonicalGenome(exampleGenome));
    expect(conciseGenome(exampleGenome).length).toBeLessThan(
      canonicalGenome(exampleGenome).length * 0.6,
    );
  });

  test("keeps a trajectory, even one that starts at the default", () => {
    const reverbLevel = {
      points: [
        [0, -12],
        [60, -12],
      ],
    };
    const text = conciseGenome({ reverbLevel });
    expect(JSON.parse(text).reverbLevel).toEqual(
      requireGenome({ reverbLevel }, "test").reverbLevel,
    );
  });

  test("throws on an invalid genome, listing its errors", () => {
    expect(() => conciseGenome({ duration: 5 })).toThrow(/\$\.duration/);
  });
});

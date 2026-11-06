/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import { randomGenome } from "../../src/engine/random-genome.js";
import { validateGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

/** @param {unknown} value @returns {Genome} */
function valid(value) {
  const result = validateGenome(value);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.genome;
}

const LENGTH = 25;

describe("excerptOffset", () => {
  test("is a pure function of genome, seed and length", () => {
    const genome = valid({ duration: 600 });
    expect(excerptOffset(genome, 7, LENGTH)).toBe(excerptOffset(valid({ duration: 600 }), 7, 25));
    const offsets = new Set(
      Array.from({ length: 50 }, (_, seed) => excerptOffset(genome, seed, 25)),
    );
    expect(offsets.size).toBeGreaterThan(45);
  });

  test("doesn't change when the voices are reordered", () => {
    const voices = [
      { id: "a", type: "fixture", start: 100 },
      { id: "b", type: "fixture", end: 400 },
    ];
    const forward = valid({ voices });
    const reversed = valid({ voices: voices.toReversed() });
    for (let seed = 0; seed < 20; seed++) {
      expect(excerptOffset(reversed, seed, LENGTH)).toBe(excerptOffset(forward, seed, LENGTH));
    }
  });

  test("puts the whole excerpt after the fade-in and before the fade-out, for 200 seeds", () => {
    for (let seed = 0; seed < 200; seed++) {
      const genome = randomGenome(seed);
      const offset = excerptOffset(genome, seed, LENGTH);
      expect(offset).toBeGreaterThanOrEqual(genome.fadeIn);
      expect(offset + LENGTH).toBeLessThanOrEqual(genome.duration - genome.fadeOut);
      if (genome.fadeIn > 0) expect(offset).toBeGreaterThan(0);
    }
  });

  test("gives 0 when there is no fade-in and the excerpt fills the rest of the timeline", () => {
    const genome = valid({ duration: 60, fadeIn: 0, fadeOut: 35 });
    expect(excerptOffset(genome, 3, LENGTH)).toBe(0);
  });

  test("throws when the excerpt doesn't fit between the fades, or its length isn't positive", () => {
    const genome = valid({ duration: 60, fadeIn: 20, fadeOut: 20 });
    expect(() => excerptOffset(genome, 1, LENGTH)).toThrow(/25 s excerpt.*20 s between the fades/);
    expect(() => excerptOffset(genome, 1, 0)).toThrow(/length/);
  });
});

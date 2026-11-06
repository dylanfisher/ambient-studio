import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { isNumeric } from "../../src/engine/descriptor.js";
import { isObject } from "../../src/engine/is-object.js";
import { randomGenome } from "../../src/engine/random-genome.js";
import { validateGenome } from "../../src/engine/validate-genome.js";
import {
  registerVoice,
  requireVoiceType,
  unregisterVoice,
  voiceParams,
  voiceTypeIds,
} from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

const SEEDS = Array.from({ length: 200 }, (_, seed) => seed);

/**
 * Every trajectory in a genome, wherever it sits.
 * @param {unknown} value
 * @returns {{ points: [number, number, string?][] }[]}
 */
function trajectories(value) {
  if (Array.isArray(value)) return value.flatMap(trajectories);
  if (!isObject(value)) return [];
  if (Array.isArray(value.points)) return [/** @type {any} */ (value)];
  return Object.values(value).flatMap(trajectories);
}

describe("randomGenome", () => {
  test("every output for 200 seeds validates, already normalized", () => {
    for (const seed of SEEDS) {
      const genome = randomGenome(seed);
      const result = validateGenome(genome);
      expect(result.ok ? [] : result.errors).toEqual([]);
      expect(result.ok && result.genome).toEqual(genome);
    }
  });

  test("is fixed by its seed", () => {
    expect(randomGenome(42)).toEqual(randomGenome(42));
    expect(randomGenome(42)).not.toEqual(randomGenome(43));
  });

  test("draws only through the seeded PRNG", () => {
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    try {
      randomGenome(5);
      expect(random).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      now.mockRestore();
    }
  });

  test("spaces trajectory breakpoints 20 to 120 s apart", () => {
    let count = 0;
    for (const seed of SEEDS) {
      for (const { points } of trajectories(randomGenome(seed))) {
        for (let i = 1; i < points.length; i++) {
          const gap =
            /** @type {number} */ (points[i]?.[0]) - /** @type {number} */ (points[i - 1]?.[0]);
          expect(gap).toBeGreaterThanOrEqual(20);
          expect(gap).toBeLessThanOrEqual(120);
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(100);
  });

  test("draws every parameter from the range its descriptor marks as safe", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      for (const voice of randomGenome(seed).voices) {
        for (const [name, descriptor] of Object.entries(voiceParams(voice.type))) {
          if (!isNumeric(descriptor) || !descriptor.safe) continue;
          const [lo, hi] = descriptor.safe;
          const value = voice[name];
          const values = isObject(value)
            ? /** @type {{ points: [number, number][] }} */ (value).points.map((p) => p[1])
            : [/** @type {number} */ (value)];
          for (const v of values) {
            expect(v, `${voice.type}.${name}`).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(v, `${voice.type}.${name}`).toBeLessThanOrEqual(hi + 1e-9);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(SEEDS.length);
  });

  test("leaves room between the fades for an excerpt", () => {
    for (const seed of SEEDS) {
      const { duration, fadeIn, fadeOut } = randomGenome(seed);
      expect(fadeIn + fadeOut).toBeLessThanOrEqual(duration / 2);
    }
  });

  test("every output stays under its cost cap, the budget when none is given", () => {
    const tight = 150;
    for (const seed of SEEDS) {
      expect(cost(randomGenome(seed))).toBeLessThanOrEqual(COST_BUDGET);
      expect(cost(randomGenome(seed, { costCap: tight }))).toBeLessThanOrEqual(tight);
    }
    // The cap changed some draws: without it, some seeds cost more.
    const uncapped = SEEDS.map((seed) => cost(randomGenome(seed, { costCap: Infinity })));
    expect(uncapped.filter((c) => c > tight).length).toBeGreaterThan(10);
  });

  test("throws when no draw can meet the cost cap", () => {
    expect(() => randomGenome(1, { costCap: 10 })).toThrow(/cost cap of 10/);
  });

  test("throws with no voice type registered", () => {
    const registered = voiceTypeIds().map(requireVoiceType);
    for (const voice of registered) unregisterVoice(voice.type);
    try {
      expect(() => randomGenome(1)).toThrow(/no voice type/);
    } finally {
      for (const voice of registered) registerVoice(voice);
    }
  });
});

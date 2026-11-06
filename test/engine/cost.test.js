import { describe, expect, test } from "vitest";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import {
  EVENT_OVERHEAD,
  eventCost,
  IR_WEIGHT,
  SWEPT_FILTER_WEIGHT,
} from "../../src/engine/cost-unit.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { masterBusCost } from "../../src/engine/master-bus.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { goldenGenomes } from "../support/golden.js";

/** @param {unknown} genome */
function expectInBudget(genome) {
  const value = cost(genome);
  if (value > COST_BUDGET) {
    throw new Error(`costs ${value} node-seconds a second, over the budget of ${COST_BUDGET}`);
  }
}

/**
 * Makes `ctx` count the audio nodes its `create…` methods return.
 * @param {BaseAudioContext} ctx
 * @returns {{ count: number }}
 */
function countNodes(ctx) {
  const counter = { count: 0 };
  /** @type {Record<string, unknown>} */
  const target = /** @type {any} */ (ctx);
  for (let proto = Object.getPrototypeOf(ctx); proto; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const original = target[name];
      if (!name.startsWith("create") || typeof original !== "function") continue;
      if (Object.hasOwn(target, name)) continue;
      target[name] = (/** @type {unknown[]} */ ...args) => {
        const made = original.apply(ctx, args);
        if (typeof made?.connect === "function") counter.count++;
        return made;
      };
    }
  }
  return counter;
}

describe("cost", () => {
  test.each(goldenGenomes())("the $name golden genome is under the budget", ({ genome }) => {
    expect(() => expectInBudget(genome)).not.toThrow();
  });

  test("a genome built to exceed the budget fails", () => {
    const [drone] = droneGenome.voices;
    const heavy = {
      ...droneGenome,
      reverbDecay: GLOBAL_PARAMS.reverbDecay.max,
      voices: Array.from({ length: 8 }, (_, i) => ({ ...drone, id: `drone${i}` })),
    };
    expect(() => expectInBudget(heavy)).toThrow(/over the budget/);
  });

  // The drone and the bus create every node up front, so the cost a second is their count plus
  // the impulse response's weight. A short render creates them all. Voices with events create
  // nodes window by window, and their cost is a rate, so their goldens aren't counted here.
  const upFront = goldenGenomes().filter(({ genome }) =>
    requireGenome(genome, "a golden genome").voices.every((voice) => voice.type === "drone"),
  );
  test.each(upFront)("counts every node a render of $name creates", async ({ genome }) => {
    const normalized = requireGenome(genome, "a golden genome");
    /** @type {{ count: number }} */
    let counter = { count: 0 };
    await renderOffline(normalized, { seed: 1, duration: 0.1 }, (ctx) => {
      counter = countNodes(ctx);
    });
    const destination = 1;
    // Each drone's swept filter is one node that costs SWEPT_FILTER_WEIGHT.
    const sweeps = normalized.voices.length * (SWEPT_FILTER_WEIGHT - 1);
    expect(counter.count + destination).toBe(
      cost(normalized) - IR_WEIGHT * normalized.reverbDecay - sweeps,
    );
  });

  test("a partial snapped to the tuning costs an oscillator in each copy", () => {
    const { key: _, ...relative } = droneGenome;
    const stack = requireGenome(
      { ...relative, tuning: "colundi", scale: "subset38" },
      "a Colundi drone",
    );
    const voice = { ...stack.voices[0], root: 55, partials: 4 };
    // Partial 4 of 55 Hz (220 Hz) snaps to 221.23 Hz; partials 1 to 3 are harmonics. In 12-TET
    // all four are harmonics of A1.
    const snapped = cost({ ...stack, voices: [voice] });
    const harmonic = cost({ ...droneGenome, voices: [{ ...voice, root: 55 }] });
    expect(snapped - harmonic).toBe(3);
  });

  test("the bus costs its nodes plus the impulse response by its length", () => {
    const genome = requireGenome(droneGenome, "the drone golden genome");
    expect(masterBusCost({ ...genome, reverbDecay: 10 }) - masterBusCost(genome)).toBe(
      IR_WEIGHT * (10 - genome.reverbDecay),
    );
  });

  test("an event node costs the seconds it sounds plus the window overhead", () => {
    expect(eventCost({ rate: 2, seconds: 0.5, nodes: 3 })).toBe(2 * 3 * (0.5 + EVENT_OVERHEAD));
  });

  test("admits the densest bell setting under the longest reverb", () => {
    // 1j's densest: 40 notes a minute, each rendered into a buffer and played by one buffer
    // source and its gain for a 15 s ring, beside the bus at its longest impulse response.
    const genome = requireGenome(
      { ...droneGenome, reverbDecay: GLOBAL_PARAMS.reverbDecay.max },
      "the drone genome with the longest reverb",
    );
    const bell = eventCost({ rate: 40 / 60, seconds: 15, nodes: 2 });
    const voiceNodes = 2;
    expect(masterBusCost(genome) + voiceNodes + bell).toBeLessThanOrEqual(COST_BUDGET);
  });
});

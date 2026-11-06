import { describe, expect, test } from "vitest";
import { macroWindow } from "../../src/domain/macro-window.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

describe("macroWindow", () => {
  test("a fixed macro reads its value at every sample", () => {
    const genome = requireGenome(droneGenome, "drone");
    const read = macroWindow(genome, "brightness", 10, 25);
    expect(read).toMatchObject({ min: 0.7, max: 0.7 });
    expect(read.mean).toBeCloseTo(0.7, 12);
  });

  test("a macro left out reads as neutral, 0.5", () => {
    const genome = requireGenome(droneGenome, "drone");
    expect(macroWindow(genome, "warmth", 10, 25)).toEqual({ min: 0.5, max: 0.5, mean: 0.5 });
  });

  test("a linear ramp over the window reads its ends and its middle", () => {
    const ramp = {
      points: [
        [10, 0],
        [35, 1, "linear"],
      ],
    };
    const genome = requireGenome(
      { ...droneGenome, macros: { ...droneGenome.macros, motion: ramp } },
      "drone with a motion ramp",
    );
    const read = macroWindow(genome, "motion", 10, 25);
    expect(read.min).toBe(0);
    expect(read.max).toBe(1);
    expect(read.mean).toBeCloseTo(0.5, 10);
  });
});

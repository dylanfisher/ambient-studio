// The vector paths the owner's locks cover (decision 0035), which nudges and optimizers leave
// alone.
import { describe, expect, test } from "vitest";
import { lockedPaths } from "../../src/domain/locked-paths.js";
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { vectorPaths } from "../../src/engine/vector-view.js";

const genome = requireGenome(exampleGenome, "example genome");
const trajectory = {
  points: [
    [0, 300],
    [120, 650, "smooth"],
    [300, 400, "smooth"],
  ],
};

describe("lockedPaths", () => {
  test("a whole trajectory covers its start and end", () => {
    const locks = [{ path: "voices.drone.cutoff", value: trajectory, voiceType: "drone" }];
    expect(lockedPaths(locks, genome)).toEqual([
      "voices.drone.cutoff.start",
      "voices.drone.cutoff.end",
    ]);
  });

  test("a number over a parameter the genome holds as a trajectory covers the path it becomes", () => {
    const locks = [{ path: "voices.drone.cutoff", value: 500, voiceType: "drone" }];
    expect(lockedPaths(locks, genome)).toEqual(["voices.drone.cutoff"]);
  });

  test("a whole voice covers every numeric path of that voice", () => {
    const pad = genome.voices.find((v) => v.id === "pad");
    const paths = lockedPaths([{ path: "voices.pad", value: pad }], genome);
    expect(paths).toEqual(vectorPaths(genome).filter((p) => p.startsWith("voices.pad.")));
    expect(paths).toContain("voices.pad.hold");
    expect(paths).toHaveLength(11);
  });

  test("a choice covers no vector path, and the result keeps the vector view's order", () => {
    const locks = [
      { path: "voices.pad.hold", value: 30, voiceType: "pad" },
      { path: "scale", value: "dorian" },
      { path: "reverbDecay", value: 8 },
    ];
    expect(lockedPaths(locks, genome)).toEqual(["reverbDecay", "voices.pad.hold"]);
  });

  test("throws on locks the genome can't take", () => {
    const locks = [{ path: "voices.choir.level", value: -12, voiceType: "pad" }];
    expect(() => lockedPaths(locks, genome)).toThrow(/voices\.choir\.level/);
  });
});

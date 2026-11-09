// What changed from a parent genome to its child (decision 0078): the paths, in the form locks
// use (0035), and the words a lineage reading groups them in.
import { describe, expect, test } from "vitest";
import { changesText, genomeChanges } from "../../src/domain/genome-changes.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import padGenome from "../../src/engine/genomes/pad.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

const drone = requireGenome(droneGenome, "drone.json");

/** @param {(genome: any) => void} change */
function changed(change) {
  const child = structuredClone(drone);
  change(child);
  return requireGenome(child, "the changed child");
}

describe("genomeChanges", () => {
  test("a genome against itself has no changes", () => {
    expect(genomeChanges(drone, drone)).toEqual([]);
  });

  test("names a global, a macro and a voice's parameter by their lock paths, from and to", () => {
    const child = changed((genome) => {
      genome.reverbDecay = 6;
      genome.macros.space = 0.8;
      genome.voices[0].root = 55;
    });
    expect(genomeChanges(drone, child)).toEqual([
      { kind: "changed", path: "reverbDecay", from: 2, to: 6 },
      { kind: "changed", path: "macros.space", from: 0.5, to: 0.8 },
      { kind: "changed", path: "voices.drone.root", type: "drone", from: 37, to: 55 },
    ]);
  });

  test("a voice added or removed is one change on the whole voice", () => {
    const pad = requireGenome(padGenome, "pad.json").voices[0];
    const child = changed((genome) => {
      genome.voices = [{ ...pad, id: "chords" }];
    });
    expect(genomeChanges(drone, child)).toEqual([
      { kind: "removed", path: "voices.drone", type: "drone" },
      { kind: "added", path: "voices.chords", type: "pad" },
    ]);
  });

  test("a voice that keeps its id but changes its type is removed and added", () => {
    const pad = requireGenome(padGenome, "pad.json").voices[0];
    const child = changed((genome) => {
      genome.voices = [{ ...pad, id: "drone" }];
    });
    expect(genomeChanges(drone, child).map(({ kind, path }) => `${kind} ${path}`)).toEqual([
      "removed voices.drone",
      "added voices.drone",
    ]);
  });

  test("a trajectory is compared whole, and a key that comes and goes is a change", () => {
    const child = changed((genome) => {
      genome.voices[0].cutoff = {
        points: [
          [0, 250],
          [30, 1200, "late"],
        ],
      };
      genome.tuning = "colundi";
      genome.scale = "core18";
      delete genome.key;
    });
    const paths = genomeChanges(drone, child).map(({ path }) => path);
    expect(paths).toEqual(["tuning", "scale", "key", "voices.drone.cutoff"]);
    expect(genomeChanges(drone, child)).toContainEqual({
      kind: "changed",
      path: "key",
      from: 2,
      to: undefined,
    });
  });
});

describe("changesText", () => {
  test("groups the changes by the piece, the macros and each voice, numbers in parentheses", () => {
    const pad = requireGenome(padGenome, "pad.json").voices[0];
    const child = changed((genome) => {
      genome.scale = "aeolian";
      genome.reverbDecay = 6;
      genome.macros.space = 0.8;
      genome.macros.warmth = 0.25;
      genome.voices[0].root = 55;
      genome.voices[0].level = {
        points: [
          [0, -30],
          [20, -10],
        ],
      };
      genome.voices.push({ ...pad, id: "chords" });
    });
    expect(changesText(genomeChanges(drone, child))).toBe(
      "scale dorian → aeolian, reverbDecay (2 → 6 s); macros: space (0.5 → 0.8), warmth (0.5 → 0.25); voice drone: level (-10 dB → moving -30 → -10 dB over 0–20 s), root (37 → 55 Hz); added voice chords, a pad",
    );
  });

  test("lists at most the limit, then says how many more", () => {
    const child = changed((genome) => {
      genome.reverbDecay = 6;
      genome.delayTime = 0.8;
      genome.macros.space = 0.8;
      genome.voices[0].root = 55;
    });
    expect(changesText(genomeChanges(drone, child), { limit: 2 })).toBe(
      "reverbDecay (2 → 6 s), delayTime (0.4 → 0.8 s); and 2 more",
    );
  });

  test("a removed voice is named with its type", () => {
    const child = changed((genome) => {
      genome.voices = [];
    });
    expect(changesText(genomeChanges(drone, child))).toBe("removed voice drone, a drone");
  });
});

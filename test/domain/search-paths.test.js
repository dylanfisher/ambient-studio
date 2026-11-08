// The paths a search may move (decision 0053).
/** @import { Lock } from "../../src/domain/validate-lock.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { expect, test } from "vitest";
import { searchPaths } from "../../src/domain/search-paths.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { vectorPaths } from "../../src/engine/vector-view.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";

const checked = validateConstraints(SEED_VIBES["cold-dorian"]?.constraints);
if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
const coldDorian = checked.constraints;
const base = requireGenome(SEED_GENOMES["cold-dorian"], "the cold-dorian seed genome");

/**
 * @param {Genome} genome
 * @param {readonly string[]} paths
 * @returns {Lock[]}
 */
function locksOn(genome, paths) {
  return paths.map((path) => {
    const taken = lockOn(genome, path);
    if (!taken.ok) throw new Error(taken.message);
    return taken.lock;
  });
}

const threeLocks = locksOn(base, ["macros.brightness", "voices.drone.cutoff", "voices.pad"]);
const all = vectorPaths(base);

test("drops a locked macro, a locked voice and the key the vibe fixes", () => {
  const free = searchPaths(base, threeLocks, coldDorian, all);
  expect(all).toContain("key");
  expect(free).not.toContain("key");
  expect(free).not.toContain("loudness");
  expect(free).not.toContain("macros.brightness");
  expect(free.filter((path) => path.startsWith("voices.pad."))).toEqual([]);
  expect(free).not.toContain("voices.drone.cutoff.start");
  expect(free).toContain("macros.space");
  expect(free).toContain("voices.drone.level");
});

test("keeps the order of the paths it was given", () => {
  const chosen = ["voices.drone.level", "macros.space", "duration"];
  expect(searchPaths(base, threeLocks, coldDorian, chosen)).toEqual(chosen);
});

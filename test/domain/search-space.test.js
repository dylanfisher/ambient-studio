// The space a search moves in: the free macros plus the owner's raw paths (decision 0053).
/** @import { Lock } from "../../src/domain/validate-lock.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { expect, test } from "vitest";
import { MAX_SEARCH_DIMENSIONS, searchSpace } from "../../src/domain/search-space.js";
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

test("is the free macros alone by default", () => {
  expect(searchSpace(base, threeLocks, coldDorian, [])).toEqual(
    all.filter((path) => path.startsWith("macros.") && path !== "macros.brightness"),
  );
});

test("adds the raw paths the owner chose, after the macros, in the vector view's order", () => {
  const space = searchSpace(base, threeLocks, coldDorian, ["voices.drone.level", "duration"]);
  expect(space.slice(-2)).toEqual(["duration", "voices.drone.level"]);
});

test.each([
  ["a locked path", "voices.pad.level"],
  ["a path the vibe fixes", "key"],
  ["a macro, which is in the space already", "macros.space"],
  ["a path the genome lacks", "voices.bell.level"],
])("refuses %s", (_, path) => {
  expect(() => searchSpace(base, threeLocks, coldDorian, [path])).toThrow(path);
});

test("refuses a path chosen twice", () => {
  expect(() => searchSpace(base, [], {}, ["duration", "duration"])).toThrow("twice");
});

test(`refuses more than ${MAX_SEARCH_DIMENSIONS} dimensions`, () => {
  const raw = all.filter((path) => !path.startsWith("macros."));
  expect(raw.length + 6).toBeGreaterThan(MAX_SEARCH_DIMENSIONS);
  expect(() => searchSpace(base, [], {}, raw)).toThrow(`at most ${MAX_SEARCH_DIMENSIONS}`);
});

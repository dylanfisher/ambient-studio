// Breeding's mutation (decision 0058): one small nudge of a crossover child, through the same
// proposal chain as every optimizer (0053).
/** @import { Lock } from "../../src/domain/validate-lock.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { expect, test } from "vitest";
import { mutateChild } from "../../src/domain/breed-mutation.js";
import { lintGenome } from "../../src/domain/lint-genome.js";
import { parseLockPath, readLockTarget } from "../../src/domain/lock-path.js";
import { lockedPaths } from "../../src/domain/locked-paths.js";
import { NUDGE_DRAWS, nudge } from "../../src/domain/nudge.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { sortedJson } from "../../src/engine/canonical-genome.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { toVector } from "../../src/engine/vector-view.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";

/** @param {unknown} constraints */
function checked(constraints) {
  const result = validateConstraints(constraints);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.constraints;
}

const constraints = checked(SEED_VIBES["cold-dorian"]?.constraints);
const child = requireGenome(SEED_GENOMES["cold-dorian"], "the cold-dorian seed genome");

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

// A macro, a voice parameter (a trajectory) and a whole voice, as acceptance 3 asks.
const locks = locksOn(child, ["macros.brightness", "voices.drone.cutoff", "voices.pad"]);

test("1,000 seeded mutations with three locks keep every locked value and pass only linted genomes", () => {
  const locked = lockedPaths(locks, child);
  const lockedVector = toVector(child, locked);
  let made = 0;
  /** @type {string[]} */
  const wrong = [];
  for (let seed = 0; seed < 1000; seed++) {
    const draws = mutateChild({ child, childId: 7, locks, constraints, seed });
    expect(draws.length).toBeLessThanOrEqual(NUDGE_DRAWS);
    for (const draw of draws) {
      if (draw.genome === null) continue;
      made++;
      for (const lock of locks) {
        const target = /** @type {NonNullable<ReturnType<typeof parseLockPath>>} */ (
          parseLockPath(lock.path)
        );
        if (sortedJson(readLockTarget(draw.genome, target)) !== sortedJson(lock.value)) {
          wrong.push(`seed ${seed}: ${lock.path}`);
        }
      }
      if (toVector(draw.genome, locked).some((u, i) => u !== lockedVector[i])) {
        wrong.push(`seed ${seed}: a locked vector path`);
      }
      if (!lintGenome(draw.genome, constraints).ok) wrong.push(`seed ${seed}: fails lint`);
    }
  }
  expect(wrong).toEqual([]);
  expect(made).toBeGreaterThan(900);
});

test("a mutation is one small nudge of the child, the same for the same seed", () => {
  const draws = mutateChild({ child, childId: 7, locks, constraints, seed: 3 });
  const [nudged] = nudge({
    base: child,
    baseId: 7,
    locks,
    constraints,
    stepSize: "small",
    seed: 3,
    count: 1,
  });
  expect(draws).toEqual(nudged);
  expect(draws.at(-1)?.genome).not.toBeNull();
});

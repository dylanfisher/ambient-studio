// Nudges (decision 0037): seeded steps in the vector view over the paths the locks leave free,
// each child linted and drawn again when it fails or repeats a genome.
/** @import { Lock } from "../../src/domain/validate-lock.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { parseLockPath, readLockTarget } from "../../src/domain/lock-path.js";
import { lockedPaths } from "../../src/domain/locked-paths.js";
import { NUDGE_DRAWS, nudge, STEP_SIZE } from "../../src/domain/nudge.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { sortedJson } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { toVector, vectorPaths } from "../../src/engine/vector-view.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";

/** @param {unknown} constraints */
function checked(constraints) {
  const result = validateConstraints(constraints);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.constraints;
}

const coldDorian = checked(SEED_VIBES["cold-dorian"]?.constraints);
const base = requireGenome(SEED_GENOMES["cold-dorian"], "the cold-dorian seed genome");
// The drone at five minutes, so its duration has room to move both ways.
const drone = requireGenome({ ...droneGenome, duration: 300 }, "the drone genome");

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

// A macro, a voice parameter (a trajectory) and a whole voice.
const threeLocks = locksOn(base, ["macros.brightness", "voices.drone.cutoff", "voices.pad"]);
const sizes = /** @type {(keyof typeof STEP_SIZE)[]} */ (Object.keys(STEP_SIZE));

describe("nudge", () => {
  test("1,000 seeded nudges with three locks leave every locked value equal to its lock", () => {
    const locked = lockedPaths(threeLocks, base);
    const lockedVector = toVector(base, locked);
    let children = 0;
    // Collected and compared once: an expect per value would take seconds over 8,000 children.
    /** @type {string[]} */
    const moved = [];
    for (let seed = 0; seed < 1000; seed++) {
      const stepSize = /** @type {keyof typeof STEP_SIZE} */ (sizes[seed % sizes.length]);
      const made = nudge({
        base,
        baseId: 1,
        locks: threeLocks,
        constraints: coldDorian,
        stepSize,
        seed,
        count: 8,
      });
      for (const draws of made) {
        for (const draw of draws) {
          if (draw.genome === null) continue;
          children++;
          for (const lock of threeLocks) {
            const target = /** @type {NonNullable<ReturnType<typeof parseLockPath>>} */ (
              parseLockPath(lock.path)
            );
            if (sortedJson(readLockTarget(draw.genome, target)) !== sortedJson(lock.value)) {
              moved.push(`seed ${seed}: ${lock.path}`);
            }
          }
          // The draw itself left them alone, so the locks had nothing to restore.
          if (sortedJson(draw.lockChanges) !== sortedJson({ locksChanged: [], locksFilled: [] })) {
            moved.push(`seed ${seed}: drawn over ${draw.lockChanges?.locksChanged}`);
          }
          const vector = toVector(draw.genome, locked);
          if (vector.some((u, i) => u !== lockedVector[i]))
            moved.push(`seed ${seed}: a vector path`);
        }
      }
    }
    expect(moved).toEqual([]);
    // Most children are made; the share redrawn is reported by the job, not held here.
    expect(children).toBeGreaterThan(4000);
  });

  test("a base that predates the locks gives children that carry every lock's value", () => {
    // Locks taken from another candidate: a voice parameter and a choice the base holds otherwise.
    const other = requireGenome(
      {
        ...droneGenome,
        duration: 300,
        scale: "aeolian",
        voices: [{ ...droneGenome.voices[0], detune: 9 }],
      },
      "the drone with another scale and detune",
    );
    const locks = locksOn(other, ["voices.drone.detune", "scale"]);
    expect(drone.scale).not.toBe("aeolian");
    expect(drone.voices[0]?.detune).not.toBe(9);
    /** @type {string[]} */
    const wrong = [];
    for (let seed = 0; seed < 50; seed++) {
      for (const draws of nudge({
        base: drone,
        baseId: 1,
        locks,
        constraints: {},
        stepSize: sizes[seed % sizes.length] ?? "small",
        seed,
        count: 4,
      })) {
        const child = draws.at(-1)?.genome;
        if (!child) continue;
        if (child.scale !== "aeolian") wrong.push(`seed ${seed}: scale ${child.scale}`);
        const detune = child.voices.find((v) => v.id === "drone")?.detune;
        if (detune !== 9) wrong.push(`seed ${seed}: detune ${detune}`);
        // The draw started from the locked base, so the locks restored nothing.
        if (
          sortedJson(draws.at(-1)?.lockChanges) !==
          sortedJson({ locksChanged: [], locksFilled: [] })
        ) {
          wrong.push(`seed ${seed}: drawn over ${draws.at(-1)?.lockChanges?.locksChanged}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("moves every free path and the macros, and holds the values the vibe fixes", () => {
    const [draws] = nudge({
      base,
      baseId: 1,
      locks: [],
      constraints: coldDorian,
      stepSize: "large",
      seed: 3,
      count: 1,
    });
    const child = draws?.at(-1)?.genome;
    if (!child) throw new Error("no child was made");
    const paths = vectorPaths(base);
    const before = toVector(base, paths);
    const after = toVector(child, paths);
    const moved = paths.filter((_, i) => after[i] !== before[i]);
    expect(moved).toContain("macros.motion");
    expect(moved).toContain("voices.pad.level");
    // The vibe fixes key and loudness, so a move there could only fail the linter.
    expect(child.key).toBe(base.key);
    expect(child.loudness).toBe(base.loudness);
  });

  test("is the same for the same seed and differs for another", () => {
    const request = {
      base,
      baseId: 4,
      locks: threeLocks,
      constraints: coldDorian,
      stepSize: /** @type {const} */ ("medium"),
      seed: 77,
      count: 4,
    };
    expect(nudge(request)).toEqual(nudge(request));
    expect(nudge({ ...request, seed: 78 })).not.toEqual(nudge(request));
    expect(nudge({ ...request, baseId: 5 })).not.toEqual(nudge(request));
  });

  test("a step is a normal draw whose spread is the step size", () => {
    // Every path free and nothing to lint against, so each child's moves are its raw steps.
    const free = vectorPaths(drone).filter((path) => !path.startsWith("voices."));
    const locks = locksOn(drone, ["voices.drone"]);
    /** @type {Record<string, number>} */
    const spread = {};
    for (const stepSize of sizes) {
      /** @type {number[]} */
      const moves = [];
      for (let seed = 0; seed < 40; seed++) {
        for (const draws of nudge({
          base: drone,
          baseId: 1,
          locks,
          constraints: {},
          stepSize,
          seed,
          count: 4,
        })) {
          const child = draws.at(-1)?.genome;
          if (!child) continue;
          const before = toVector(drone, free);
          const after = toVector(child, free);
          // Steps clipped at 0 or 1 would shrink the spread, so only interior ones count.
          after.forEach((u, i) => {
            if (u > 0 && u < 1) moves.push(u - /** @type {number} */ (before[i]));
          });
        }
      }
      const rms = Math.sqrt(moves.reduce((sum, m) => sum + m * m, 0) / moves.length);
      spread[stepSize] = Math.round(rms * 100) / 100;
    }
    // Ints round, and steps near an end are clipped, so the spread sits near the step size.
    expect(spread.small).toBeCloseTo(STEP_SIZE.small, 1);
    expect(spread.medium).toBeCloseTo(STEP_SIZE.medium, 1);
    expect(spread.large).toBeGreaterThan(STEP_SIZE.medium);
  });

  test("a draw that fails lint is kept rejected and drawn again", () => {
    // Only duration moves, inside a narrow range: some draws leave it.
    const locks = locksOn(
      drone,
      vectorPaths(drone).filter((p) => p !== "duration" && !p.startsWith("voices.")),
    );
    const all = [...locks, ...locksOn(drone, ["voices.drone"])];
    const constraints = checked({
      duration: { min: drone.duration - 40, max: drone.duration + 40 },
    });
    const made = nudge({
      base: drone,
      baseId: 1,
      locks: all,
      constraints,
      stepSize: "medium",
      seed: 9,
      count: 8,
    });
    const redrawn = made.find((draws) => draws.length > 1 && draws.at(-1)?.genome);
    if (!redrawn) throw new Error("no child was drawn again");
    for (const draw of redrawn.slice(0, -1)) {
      expect(draw.reason).toBe(REJECT_REASON.lintErrors);
      expect(draw.genome).toBeNull();
      expect(draw.lint.findings.map((f) => f.rule)).toContain("duration");
      expect(draw.written).toMatchObject({ voices: drone.voices });
    }
    expect(redrawn.at(-1)).toMatchObject({ reason: null, lint: { ok: true } });
  });

  test("a draw equal to its base or a sibling is kept rejected and drawn again", () => {
    // Only the int `key` is free, and a small step on 12 values often rounds back.
    const free = "key";
    const locks = locksOn(
      drone,
      vectorPaths(drone).filter((p) => p !== free && !p.startsWith("voices.")),
    );
    const all = [...locks, ...locksOn(drone, ["voices.drone"])];
    const made = nudge({
      base: drone,
      baseId: 1,
      locks: all,
      constraints: {},
      stepSize: "small",
      seed: 2,
      count: 8,
    });
    const repeats = made.flat().filter((d) => d.reason === REJECT_REASON.repeated);
    expect(repeats.length).toBeGreaterThan(0);
    for (const draw of repeats) {
      expect(draw.genome).toBeNull();
      expect(draw.lint.findings[0]?.message).toMatch(/^the draw repeats (the base|child \d+)/);
    }
    const keys = made.flatMap((draws) => {
      const child = draws.at(-1)?.genome;
      return child ? [child.key] : [];
    });
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(drone.key);
  });

  test(`a child whose ${NUDGE_DRAWS} draws all fail comes back with no genome`, () => {
    const constraints = checked({ duration: { min: drone.duration, max: drone.duration } });
    const locks = locksOn(
      drone,
      vectorPaths(drone).filter((p) => p !== "duration" && !p.startsWith("voices.")),
    );
    const made = nudge({
      base: drone,
      baseId: 1,
      locks: [...locks, ...locksOn(drone, ["voices.drone"])],
      constraints,
      stepSize: "large",
      seed: 1,
      count: 2,
    });
    for (const draws of made) {
      expect(draws).toHaveLength(NUDGE_DRAWS);
      expect(draws.every((d) => d.genome === null && d.reason !== null)).toBe(true);
    }
  });

  test("a draw the schema refuses is kept with its errors and drawn again", () => {
    // Long fades on a short timeline: a step that shortens it or lengthens a fade breaks
    // fadeIn + fadeOut ≤ duration.
    const tight = requireGenome(
      { ...droneGenome, duration: 120, fadeIn: 60, fadeOut: 60 },
      "a drone with fades filling its timeline",
    );
    const made = nudge({
      base: tight,
      baseId: 1,
      locks: [],
      constraints: {},
      stepSize: "medium",
      seed: 0,
      count: 8,
    });
    const refused = made.flat().filter((d) => d.reason === REJECT_REASON.schemaErrors);
    expect(refused.length).toBeGreaterThan(0);
    for (const draw of refused) {
      expect(draw.genome).toBeNull();
      expect(draw.lint.findings.some((f) => f.rule === "schema")).toBe(true);
      expect(draw.written).toMatchObject({ voices: [{ id: "drone" }] });
    }
  });

  test("throws when the base can't take the locks", () => {
    const locks = [{ path: "voices.choir.level", value: -12, voiceType: "pad" }];
    expect(() =>
      nudge({ base, baseId: 1, locks, constraints: {}, stepSize: "small", seed: 0, count: 1 }),
    ).toThrow(/voices\.choir\.level/);
  });
});

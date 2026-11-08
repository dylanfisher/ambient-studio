// A search run against the fake sidecar (decision 0053): every point stored as a candidate, only
// those that pass scored, rejected ones told a penalty, and a sidecar failure never retried.
/** @import { Lock } from "../../src/domain/validate-lock.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { applyLocks } from "../../src/domain/apply-locks.js";
import { lintGenome } from "../../src/domain/lint-genome.js";
import { parseLockPath, readLockTarget } from "../../src/domain/lock-path.js";
import { lockedPaths } from "../../src/domain/locked-paths.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { searchSpace } from "../../src/domain/search-space.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { canonicalGenome, sortedJson } from "../../src/engine/canonical-genome.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { toVector } from "../../src/engine/vector-view.js";
import { getGenome, listSessionCandidates } from "../../src/server/generation-store.js";
import { searchGeneration, searchRunFolder, startSearch } from "../../src/server/search-run.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

const checked = validateConstraints(SEED_VIBES["cold-dorian"]?.constraints);
if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
const constraints = checked.constraints;
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

// A macro, a voice parameter (a trajectory) and a whole voice, as acceptance 3 asks.
const locks = locksOn(base, ["macros.brightness", "voices.drone.cutoff", "voices.pad"]);
const start = applyLocks(base, locks).genome;
const paths = searchSpace(start, locks, constraints, ["duration", "voices.drone.level"]);
const origin = {
  seed: 11,
  source: "optimizer",
  parentIds: [1],
  // 5e names the search's operator; this one is the test's.
  operator: "test-search",
  operatorParams: { run: "run-1" },
};

/** A test app with a vibe under cold-dorian's constraints and a session on it. */
async function searchApp() {
  const made = await testApp();
  apps.push(made);
  const vibe = createVibe(made.app.store, { ...VIBE, constraints });
  const session = startSession(made.app.store, vibe.id);
  const batch = {
    store: made.app.store,
    vibeId: vibe.id,
    vibeRevisionId: vibe.revision.id,
    sessionId: session.id,
    locks,
  };
  const context = {
    locks,
    constraints,
    seen: new Map([[canonicalGenome(start), "the base with the locks applied"]]),
  };
  return { ...made, batch, context, session };
}

const spec = (/** @type {number} */ seed) => ({
  optimizer: "scripted",
  start: toVector(start, paths),
  seed,
  settings: {},
});

/**
 * @param {TestApp["app"]} app
 * @param {number | null} id
 */
function genomeOf(app, id) {
  const row = id === null ? undefined : getGenome(app.store, id);
  if (!row) throw new Error(`no genome ${id}`);
  return row.genome;
}

/** @param {{ params: Record<string, unknown> }} received */
const told = ({ params }) => JSON.parse(readFileSync(String(params.scores), "utf8")).scores;

test("a generation stores every point, scores only those that pass, and penalizes the rest", async () => {
  const { app, sidecar, batch, context } = await searchApp();
  const origin0 = toVector(start, paths);
  /** @param {string} path @param {number} position */
  const moved = (path, position) => origin0.map((u, i) => (paths[i] === path ? position : u));
  const points = [
    moved("macros.space", 0.9),
    origin0, // the base itself: a repeat
    moved("duration", 0), // below the vibe's 300 s floor
    moved("macros.motion", 0.1),
  ];
  sidecar.script(
    { do: "answer", result: { dimension: paths.length } },
    { do: "answer", result: { count: 4 }, points },
    { do: "answer", result: { generations: 1 } },
  );
  const folder = await startSearch(app, "run-1", spec(5), { signal: AbortSignal.timeout(20_000) });
  expect(folder).toBe(join(app.config.dataRoot, "search", "run-1"));
  /** @type {Candidate[]} */
  const evaluated = [];
  const result = await searchGeneration(app, folder, {
    generation: 0,
    count: 4,
    start,
    paths,
    context,
    batch,
    origin,
    evaluate: async (candidates) => {
      evaluated.push(...candidates);
      return [0.2, 0.8];
    },
    signal: new AbortController().signal,
  });

  expect(result.candidates.map((c) => c.rejectReason)).toEqual([
    null,
    REJECT_REASON.repeated,
    REJECT_REASON.lintErrors,
    null,
  ]);
  // The rejected points were stored, with the genome as written, and never handed on to render.
  expect(evaluated.map((c) => c.id)).toEqual([result.candidates[0]?.id, result.candidates[3]?.id]);
  for (const rejected of [result.candidates[1], result.candidates[2]]) {
    expect(rejected?.genomeId).toBeNull();
    expect(rejected?.rejectedGenome).not.toBeNull();
  }
  expect(result.candidates.map((c) => c.operatorParams)).toEqual(
    [0, 1, 2, 3].map((point) => expect.objectContaining({ run: "run-1", generation: 0, point })),
  );
  expect(listSessionCandidates(app.store, batch.sessionId)).toHaveLength(4);

  // Worst valid 0.2, less the population standard deviation 0.3.
  const penalty = 0.2 - 0.3;
  expect(result.scores).toEqual([0.2, null, null, 0.8]);
  const received = await sidecar.received();
  expect(received.map((r) => r.request.method)).toEqual([
    "optimizer_start",
    "optimizer_ask",
    "optimizer_tell",
  ]);
  const tellScores = told(/** @type {any} */ (received[2]?.request));
  expect(tellScores).toHaveLength(4);
  expect(tellScores[0]).toBe(0.2);
  expect(tellScores[1]).toBeCloseTo(penalty, 12);
  expect(tellScores[2]).toBeCloseTo(penalty, 12);
  expect(tellScores[3]).toBe(0.8);
  expect(received[2]?.request.params).toEqual({
    run: folder,
    points: join(folder, "ask-0.json"),
    scores: join(folder, "tell-0.json"),
  });
});

test("a generation with no point that passes tells −1 for each and scores nothing", async () => {
  const { app, sidecar, batch, context } = await searchApp();
  const origin0 = toVector(start, paths);
  sidecar.script(
    { do: "answer", result: { dimension: paths.length } },
    { do: "answer", result: { count: 1 }, points: [origin0] },
    { do: "answer", result: { generations: 1 } },
  );
  const folder = await startSearch(app, "run-1", spec(5), { signal: AbortSignal.timeout(20_000) });
  const result = await searchGeneration(app, folder, {
    generation: 0,
    count: 1,
    start,
    paths,
    context,
    batch,
    origin,
    evaluate: async () => {
      throw new Error("nothing valid should be scored");
    },
    signal: new AbortController().signal,
  });
  expect(result.told).toEqual([-1]);
});

test("a sidecar error on an ask fails the generation and is not retried", async () => {
  const { app, sidecar, batch, context } = await searchApp();
  sidecar.script(
    { do: "answer", result: { dimension: paths.length } },
    { do: "error", error: "the script has 0 points left, and 2 were asked" },
  );
  const folder = await startSearch(app, "run-1", spec(5), { signal: AbortSignal.timeout(20_000) });
  await expect(
    searchGeneration(app, folder, {
      generation: 0,
      count: 2,
      start,
      paths,
      context,
      batch,
      origin,
      evaluate: async () => [],
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("0 points left");
  expect(await sidecar.received()).toHaveLength(2);
  expect(listSessionCandidates(app.store, batch.sessionId)).toEqual([]);
});

test("a run that exists is refused before the sidecar is asked", async () => {
  const { app, sidecar } = await searchApp();
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  await startSearch(app, "run-1", spec(5), { signal: AbortSignal.timeout(20_000) });
  await expect(
    startSearch(app, "run-1", spec(5), { signal: AbortSignal.timeout(20_000) }),
  ).rejects.toThrow("EEXIST");
  expect(await sidecar.received()).toHaveLength(1);
  expect(() => searchRunFolder(app.config.dataRoot, "../elsewhere")).toThrow("name");
});

test("1,000 seeded asks under three locks keep every lock and score no genome lint rejects", async () => {
  const { app, sidecar, batch, context, session } = await searchApp();
  const held = lockedPaths(locks, start);
  // No locked path is a dimension of the search.
  expect(paths.filter((path) => held.includes(path))).toEqual([]);
  const asks = 1000;
  const count = 8;
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  for (let ask = 0; ask < asks; ask++) {
    sidecar.script(
      { do: "answer", result: { count }, points: { seed: ask, spread: 0.12 } },
      { do: "answer", result: { generations: ask + 1 } },
    );
  }
  const folder = await startSearch(app, "run-1", spec(1), { signal: AbortSignal.timeout(20_000) });
  /** @type {string[]} */
  const wrong = [];
  let scored = 0;
  for (let generation = 0; generation < asks; generation++) {
    await searchGeneration(app, folder, {
      generation,
      count,
      start,
      paths,
      context,
      batch,
      origin,
      evaluate: async (candidates) =>
        candidates.map((candidate) => {
          scored++;
          const genome = genomeOf(app, candidate.genomeId);
          if (!lintGenome(genome, constraints).ok) wrong.push(`${candidate.id}: lint`);
          return genome.duration / 1000;
        }),
      signal: new AbortController().signal,
    });
  }
  const stored = listSessionCandidates(app.store, session.id);
  expect(stored).toHaveLength(asks * count);
  for (const candidate of stored) {
    if (candidate.genomeId === null) continue;
    const genome = genomeOf(app, candidate.genomeId);
    for (const lock of locks) {
      const target = /** @type {NonNullable<ReturnType<typeof parseLockPath>>} */ (
        parseLockPath(lock.path)
      );
      if (sortedJson(readLockTarget(genome, target)) !== sortedJson(lock.value)) {
        wrong.push(`${candidate.id}: ${lock.path}`);
      }
    }
  }
  expect(wrong).toEqual([]);
  const valid = stored.filter((c) => c.rejectReason === null).length;
  expect(scored).toBe(valid);
  // Most points pass; the rest are stored rejected and were never scored.
  expect(valid).toBeGreaterThan(asks * count * 0.5);
  expect(valid).toBeLessThan(asks * count);
}, 120_000);

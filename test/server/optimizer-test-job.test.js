// The optimizer test job (decision 0059) against the fake sidecar's optimizer, with a scripted
// scorer in place of render, embed and predict and a scripted model check, so nothing is
// rendered: per brief it runs 3 searches with their controls, stores the comparison, the
// verdict on 4e's agreement, the spot-check pairs and the timings in `evaluations`, and leaves
// out a brief with no model or no base, saying why.
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { Scorer } from "../../src/server/search-job.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { OPERATOR } from "../../src/domain/operator.js";
import {
  compareRuns,
  MODEL_INCONCLUSIVE,
  OPTIMIZER_TEST,
} from "../../src/domain/optimizer-report.js";
import { BENCH_SECONDS } from "../../src/domain/search-cost.js";
import { searchPopulation } from "../../src/domain/search-settings.js";
import { searchSpace } from "../../src/domain/search-space.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { EVALUATION_KIND, listEvaluations } from "../../src/server/evaluation-store.js";
import {
  addCandidate,
  getCandidate,
  getGenome,
  putGenome,
} from "../../src/server/generation-store.js";
import { optimizerTestJob, topRanked } from "../../src/server/optimizer-test-job.js";
import { writePreferenceTest } from "../../src/server/preference-test-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { vibeLoudness } from "../../src/server/render-excerpt.js";
import { putRender } from "../../src/server/render-store.js";
import { startSession, stopSession } from "../../src/server/session-store.js";
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
const dimensions = searchSpace(base, [], constraints, []).length;
const population = searchPopulation(dimensions);
const KEY = "model-key";
const hasModel = async () => /** @type {const} */ ({ reason: null, key: KEY });

/**
 * A test app with a vibe under cold-dorian's constraints, a session and a base candidate.
 * @param {{ macros?: Record<string, number> }} [options] the base's macros
 */
async function testedApp({ macros } = {}) {
  const made = await testApp();
  apps.push(made);
  const { store } = made.app;
  const vibe = createVibe(store, { ...VIBE, constraints });
  const session = startSession(store, vibe.id);
  /** @param {Record<string, number>} [set] */
  const seedCandidate = (set) =>
    addCandidate(store, {
      generationId: null,
      vibeRevisionId: vibe.revision.id,
      sessionId: session.id,
      genomeId: putGenome(
        store,
        vibe.id,
        set ? { ...base, macros: { ...base.macros, ...set } } : base,
      ).id,
      seed: 7,
      source: "llm",
      parentIds: [],
      locks: [],
      operator: null,
      operatorParams: null,
      intent: "seeded",
      rejectReason: null,
      lint: null,
      rejectedGenome: null,
    });
  return { ...made, vibe, session, candidate: seedCandidate(macros), seedCandidate };
}

/**
 * A scorer that scores each point by how near its space macro is to 0.8.
 * @param {TestApp["app"]} app
 */
function scripted(app) {
  /** @type {Scorer} */
  const score = async (candidates) =>
    candidates.map((candidate) => {
      const row = getGenome(app.store, /** @type {number} */ (candidate.genomeId));
      const space = /** @type {any} */ (row?.genome)?.macros?.space ?? 0.5;
      return {
        score: -((space - 0.8) ** 2),
        embedding: Float32Array.from([space, 1]),
        seconds: { render: 1.5, embed: 0.25 },
      };
    });
  return async () => score;
}

/**
 * Scripts the fake sidecar for `runs` searches: a start, then an ask and a tell per generation.
 * @param {TestApp["sidecar"]} sidecar
 * @param {number} budget
 * @param {number} runs
 */
function scriptRuns(sidecar, budget, runs) {
  for (let r = 0; r < runs; r++) {
    sidecar.script({ do: "answer", result: { dimension: dimensions } });
    for (let asked = 0, g = 0; asked < budget; asked += population, g++) {
      const count = Math.min(population, budget - asked);
      sidecar.script(
        { do: "answer", result: { count }, points: { seed: 10 * r + g, spread: 0.12 } },
        { do: "answer", result: { generations: g + 1 } },
      );
    }
  }
}

/** Runs a job function through the app's runner and returns its finished status. */
async function run(/** @type {TestApp["app"]} */ app, /** @type {any} */ job) {
  const status = app.jobs.add("optimizer-test", job);
  await app.jobs.settled(status.id);
  return app.jobs.get(status.id);
}

/** The stored optimizer tests' reports. */
const reports = (/** @type {TestApp["app"]} */ app) =>
  listEvaluations(app.store, EVALUATION_KIND.optimizer).map((e) => /** @type {any} */ (e));

/**
 * Writes the taste test's report with the brief's model agreement.
 * @param {TestApp["app"]} app
 * @param {number} vibeId
 * @param {number} low
 */
const agreeing = (app, vibeId, low) =>
  writePreferenceTest(app.paths, {
    createdAt: 5,
    vibes: [
      {
        vibeId,
        test: { model: { agreement: { agreed: 30, scored: 40, share: 0.75, low, high: 0.9 } } },
      },
    ],
  });

test("a brief with a model gets 3 searches with their controls, compared, paired and timed", async () => {
  const made = await testedApp();
  const { app, sidecar, vibe, session, candidate } = made;
  const budget = population + 2;
  scriptRuns(sidecar, budget, OPTIMIZER_TEST.runs);
  await agreeing(app, vibe.id, 0.6);
  /** @type {[number, number, string | null][]} */
  const steps = [];
  const job = optimizerTestJob(
    app,
    { vibes: [{ vibeId: vibe.id, candidateIds: [candidate.id] }], budget },
    { makeScorer: scripted(app), check: hasModel },
  );
  const done = await run(app, (/** @type {any} */ context) =>
    job({
      ...context,
      progress: (/** @type {number} */ n, /** @type {number} */ of, /** @type {any} */ step) => {
        steps.push([n, of, step]);
        context.progress(n, of, step);
      },
    }),
  );
  expect(done.error).toBeNull();
  expect(done.state).toBe("done");

  const [stored] = reports(app);
  expect(stored.id).toBe(/** @type {any} */ (done.result).evaluationId);
  expect(stored.params).toMatchObject({
    kind: EVALUATION_KIND.optimizer,
    budget,
    runs: OPTIMIZER_TEST.runs,
  });
  const [tested] = stored.report.vibes;
  expect(tested).toMatchObject({
    vibeId: vibe.id,
    leftOut: null,
    agreement: { share: 0.75, low: 0.6, high: 0.9, scored: 40 },
    agreementAt: 5,
  });
  expect(tested.runs).toHaveLength(OPTIMIZER_TEST.runs);
  for (const each of tested.runs) {
    expect(each).toMatchObject({
      baseId: candidate.id,
      sessionId: session.id,
    });
    // A point the linter or the repeat check rejects is asked and stored but never scored.
    expect(each.evaluated).toBeGreaterThanOrEqual(OPTIMIZER_TEST.spotPairsPerRun);
    expect(each.evaluated).toBeLessThanOrEqual(budget);
    expect(each.controlEvaluated).toBeGreaterThanOrEqual(OPTIMIZER_TEST.spotPairsPerRun);
    expect(getCandidate(app.store, each.search.candidateId)?.operator).toBe(OPERATOR.optimize);
    expect(getCandidate(app.store, each.control.candidateId)?.operator).toBe(
      OPERATOR.optimizeControl,
    );
  }
  expect(tested.model).toEqual(
    compareRuns(
      tested.runs.map((/** @type {any} */ r) => ({
        search: r.search.score,
        control: r.control.score,
      })),
    ),
  );
  expect(tested.verdict.counts).toBe(true);

  // Each run's arms paired best to best, 4 a run, in the base's session, sides by a stored seed.
  expect(tested.spotChecks).toHaveLength(OPTIMIZER_TEST.minimumPairs);
  for (const pair of tested.spotChecks) {
    expect(pair.sessionId).toBe(session.id);
    expect(Number.isInteger(pair.orderSeed)).toBe(true);
    const search = getCandidate(app.store, pair.search.candidateId);
    const control = getCandidate(app.store, pair.control.candidateId);
    expect(search?.operator).toBe(OPERATOR.optimize);
    expect(control?.operator).toBe(OPERATOR.optimizeControl);
    expect(pair.search).toMatchObject({ genomeId: search?.genomeId, seed: search?.seed });
    expect(pair.control).toMatchObject({ genomeId: control?.genomeId, seed: control?.seed });
  }
  expect(tested.spotChecks.filter((/** @type {any} */ p) => p.rank === 1)).toEqual(
    tested.runs.map((/** @type {any} */ r) =>
      expect.objectContaining({
        run: r.run,
        search: expect.objectContaining({ candidateId: r.search.candidateId }),
        control: expect.objectContaining({ candidateId: r.control.candidateId }),
      }),
    ),
  );

  // Timed against the bench's estimate, since no search had run when it started.
  expect(tested.timings.estimate).toMatchObject({
    perEvaluation: BENCH_SECONDS,
    measured: false,
  });
  expect(tested.timings.estimate.seconds).toBeCloseTo(
    OPTIMIZER_TEST.runs * 2 * budget * (BENCH_SECONDS.render + BENCH_SECONDS.embed),
  );
  expect(tested.timings.took).toMatchObject({
    perEvaluation: { render: 1.5, embed: 0.25 },
    evaluations: tested.runs.reduce(
      (/** @type {number} */ sum, /** @type {any} */ r) => sum + r.evaluated + r.controlEvaluated,
      0,
    ),
  });
  expect(tested.coverage).toBeNull();

  // Progress runs across the three searches, each step naming the brief and the search.
  const total = OPTIMIZER_TEST.runs * 2 * budget;
  expect(steps.every(([, of]) => of === total)).toBe(true);
  expect(steps).toContainEqual([
    2 * budget,
    total,
    "Testing the optimizer on brief 1 of 1, search 2 of 3: Searching: generation 1 of 2",
  ]);
  expect(steps.at(-1)).toEqual([total, total, null]);
});

test("a lower agreement bound at 0.5 stores the inconclusive verdict whatever the scores", async () => {
  const made = await testedApp();
  const { app, sidecar, vibe, candidate } = made;
  const budget = 4;
  scriptRuns(sidecar, budget, OPTIMIZER_TEST.runs);
  await agreeing(app, vibe.id, 0.5);
  const done = await run(
    app,
    optimizerTestJob(
      app,
      { vibes: [{ vibeId: vibe.id, candidateIds: [candidate.id] }], budget },
      { makeScorer: scripted(app), check: hasModel },
    ),
  );
  expect(done.error).toBeNull();
  const [tested] = reports(app)[0].report.vibes;
  expect(tested.model).not.toBeNull();
  expect(tested.verdict).toMatchObject({ counts: false, text: MODEL_INCONCLUSIVE });
});

test("a brief with no model, or no ranked base, is left out with the reason", async () => {
  const made = await testedApp();
  const { app, sidecar, vibe, store } = { ...made, store: made.app.store };
  const other = createVibe(store, { ...VIBE, name: "second", constraints });
  const done = await run(
    app,
    optimizerTestJob(
      app,
      {
        vibes: [
          { vibeId: vibe.id, candidateIds: [] },
          { vibeId: other.id, candidateIds: [] },
        ],
        budget: 4,
      },
      {
        makeScorer: scripted(app),
        check: async (_, vibeId) =>
          vibeId === vibe.id
            ? { reason: "This brief has no taste model yet.", key: null }
            : { reason: null, key: KEY },
      },
    ),
  );
  expect(done.error).toBeNull();
  const [noModel, noBase] = reports(app)[0].report.vibes;
  expect(noModel).toMatchObject({
    vibeId: vibe.id,
    leftOut: "This brief has no taste model yet.",
    runs: [],
    spotChecks: [],
  });
  expect(noBase.vibeId).toBe(other.id);
  expect(noBase.leftOut).toMatch(/^No candidate in an open session is ranked/);
  expect(await sidecar.received()).toEqual([]);
});

test("the bases default to the top-ranked candidates under the current model, one per genome", async () => {
  const made = await testedApp({ macros: { space: 0.1 } });
  const { app, vibe, session, candidate, seedCandidate } = made;
  const { store, paths } = app;
  const better = seedCandidate({ space: 0.2 });
  const best = seedCandidate({ space: 0.3 });
  const sameGenome = seedCandidate({ space: 0.3 });
  const unranked = seedCandidate({ space: 0.4 });
  const stopped = startSession(store, vibe.id);
  await mkdir(paths.renderCache, { recursive: true });
  /** @type {Map<number, number>} */
  const renders = new Map();
  /** @type {Map<number | null, number>} one render per genome, as candidates share one */
  const byGenome = new Map();
  for (const each of [candidate, better, best, sameGenome, unranked]) {
    const shared = byGenome.get(each.genomeId);
    if (shared !== undefined) {
      renders.set(each.id, shared);
      continue;
    }
    const row = getGenome(store, /** @type {number} */ (each.genomeId));
    const offset = excerptOffset(/** @type {any} */ (row?.genome), each.seed, EXCERPT_SECONDS);
    const file = `seeded-${each.id}.mp3`;
    await writeFile(join(paths.renderCache, file), "");
    const { render } = putRender(store, {
      genomeId: /** @type {number} */ (each.genomeId),
      seed: each.seed,
      offset,
      duration: EXCERPT_SECONDS,
      target: vibeLoudness(constraints),
      producer: PRODUCER,
      file,
      features: {},
      checks: [],
    });
    renders.set(each.id, render.id);
    byGenome.set(each.genomeId, render.id);
  }
  /**
   * @param {number} sessionId
   * @param {string} modelKey
   * @param {[Candidate, number][]} scored
   */
  const rank = (sessionId, modelKey, scored) =>
    writeFile(
      join(paths.rankings, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        modelKey,
        excerpts: scored.map(([c, score], i) => ({
          renderId: renders.get(c.id),
          score,
          rank: i + 1,
          wildcard: false,
          slot: i + 1,
        })),
        covariance: [],
      }),
    );
  await mkdir(paths.rankings, { recursive: true });
  await rank(session.id, KEY, [
    [candidate, 1],
    [better, 2],
    [best, 3],
    [sameGenome, 3],
  ]);
  // A stopped session takes no search points, and a ranking under an older model isn't read.
  stopSession(store, stopped.id);
  await rank(stopped.id, KEY, [[unranked, 9]]);
  expect((await topRanked(app, vibe.id, KEY, 3)).map((c) => c.id)).toEqual([
    best.id,
    better.id,
    candidate.id,
  ]);
  expect(await topRanked(app, vibe.id, "older-key", 3)).toEqual([]);
});

// The model-in-the-loop search job (decision 0054) against the fake sidecar's optimizer, with a
// scripted scorer in place of render, embed and predict, so nothing is rendered: it stops at its
// budget, shows the best 4 apart in sound, runs its control arm, keeps rows on a cancel, records
// the timings the estimate reads, and holds the locks.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { Scorer } from "../../src/server/search-job.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parseLockPath, readLockTarget } from "../../src/domain/lock-path.js";
import { OPERATOR } from "../../src/domain/operator.js";
import { BENCH_SECONDS } from "../../src/domain/search-cost.js";
import { searchPopulation } from "../../src/domain/search-settings.js";
import { MIN_SHOWN_DISTANCE, shownPoints } from "../../src/domain/search-shown.js";
import { searchSpace } from "../../src/domain/search-space.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { sortedJson } from "../../src/engine/canonical-genome.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import {
  addCandidate,
  getGenome,
  listSessionCandidates,
  putGenome,
} from "../../src/server/generation-store.js";
import { setLock } from "../../src/server/lock-store.js";
import { modelFile, modelPlan } from "../../src/server/preference-model.js";
import { readSearchResults, searchEstimate, searchJob } from "../../src/server/search-job.js";
import { SESSION_ROUTES } from "../../src/server/session-routes.js";
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
const dimensions = searchSpace(base, [], constraints, []).length;
const population = searchPopulation(dimensions);

/** A test app with a vibe under cold-dorian's constraints, a session, and a base candidate. */
async function searchApp() {
  const made = await testApp();
  apps.push(made);
  const { store } = made.app;
  const vibe = createVibe(store, { ...VIBE, constraints });
  const session = startSession(store, vibe.id);
  const candidate = addCandidate(store, {
    generationId: null,
    vibeRevisionId: vibe.revision.id,
    sessionId: session.id,
    genomeId: putGenome(store, vibe.id, base).id,
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
  return { ...made, vibe, session, candidate };
}

/**
 * @param {TestApp["app"]} app
 * @param {number | null} id
 * @returns {Genome}
 */
function genomeOf(app, id) {
  const row = id === null ? undefined : getGenome(app.store, id);
  if (!row) throw new Error(`no genome ${id}`);
  return requireGenome(row.genome, `genome ${id}`);
}

/**
 * The point's space and motion macros, which the scripted scorer reads; 0.5 when unset.
 * @param {TestApp["app"]} app
 * @param {Candidate} candidate
 */
function macrosOf(app, candidate) {
  const macros = /** @type {Record<string, number>} */ (
    genomeOf(app, candidate.genomeId).macros ?? {}
  );
  return { space: macros.space ?? 0.5, motion: macros.motion ?? 0.5 };
}

/** @param {Candidate} candidate @returns {any} */
const paramsOf = (candidate) => candidate.operatorParams;

/**
 * A run's summary, which must exist.
 * @param {TestApp["app"]} app
 * @param {string} run
 */
async function resultsOf(app, run) {
  const saved = await readSearchResults(app.paths.search, run);
  if (!saved) throw new Error(`run ${run} has no summary`);
  return /** @type {any} */ (saved);
}

/**
 * A scorer that scores each point by how near its space macro is to 0.8, embeds it as its
 * space and motion macros, and takes `seconds` for each step; `onScore` runs before each batch.
 * @param {TestApp["app"]} app
 * @param {{ seconds?: { render: number, embed: number }, onScore?: () => void }} [options]
 * @returns {{ scorer: () => Promise<Scorer>, scored: Candidate[] }}
 */
function scripted(app, { seconds = { render: 1.5, embed: 0.25 }, onScore } = {}) {
  /** @type {Candidate[]} */
  const scored = [];
  /** @type {Scorer} */
  const score = async (candidates, signal) => {
    onScore?.();
    signal.throwIfAborted();
    scored.push(...candidates);
    return candidates.map((candidate) => {
      const { space, motion } = macrosOf(app, candidate);
      return {
        score: -((space - 0.8) ** 2),
        embedding: Float32Array.from([space, motion, 1]),
        seconds,
      };
    });
  };
  return { scorer: async () => score, scored };
}

/**
 * Scripts the fake sidecar for a run: a start, then an ask and a tell per generation, each ask
 * drawing near the start with its own seed.
 * @param {TestApp["sidecar"]} sidecar
 * @param {number} budget
 */
function scriptRun(sidecar, budget) {
  sidecar.script({ do: "answer", result: { dimension: dimensions } });
  for (let asked = 0, g = 0; asked < budget; asked += population, g++) {
    const count = Math.min(population, budget - asked);
    sidecar.script(
      { do: "answer", result: { count }, points: { seed: 100 + g, spread: 0.12 } },
      { do: "answer", result: { generations: g + 1 } },
    );
  }
}

/** @param {Awaited<ReturnType<typeof searchApp>>} made @param {Partial<{ budget: number, control: boolean }>} [options] */
const request = (made, { budget = 13, control = false } = {}) => ({
  vibeId: made.vibe.id,
  sessionId: made.session.id,
  base: made.candidate,
  genome: base,
  budget,
  raw: [],
  control,
});

/** Runs a job function through the app's runner and returns its finished status. */
async function run(/** @type {TestApp["app"]} */ app, /** @type {any} */ job) {
  const status = app.jobs.add("search", job);
  await app.jobs.settled(status.id);
  return app.jobs.get(status.id);
}

test("the job stops at its budget, a short last generation included, with progress per generation", async () => {
  const made = await searchApp();
  const { app, sidecar, session } = made;
  const budget = population * 2 + 3;
  scriptRun(sidecar, budget);
  const { scorer } = scripted(app);
  /** @type {unknown[]} */
  const steps = [];
  const job = searchJob(app, request(made, { budget }), { makeScorer: scorer });
  const status = app.jobs.add("search", (context) =>
    job({
      ...context,
      progress: (done, total, step) => {
        steps.push([done, total, step]);
        context.progress(done, total, step);
      },
    }),
  );
  await app.jobs.settled(status.id);
  const done = app.jobs.get(status.id);
  expect(done.error).toBeNull();
  expect(done.state).toBe("done");

  const asks = (await sidecar.received()).filter((r) => r.request.method === "optimizer_ask");
  expect(asks.map((r) => /** @type {any} */ (r.request.params).count)).toEqual([
    population,
    population,
    3,
  ]);
  const points = listSessionCandidates(app.store, session.id).filter(
    (c) => c.operator === OPERATOR.optimize,
  );
  expect(points).toHaveLength(budget);
  expect(
    points.every((c) => c.source === "optimizer" && c.parentIds[0] === made.candidate.id),
  ).toBe(true);
  expect(points.map((c) => [paramsOf(c).generation, paramsOf(c).point])).toEqual(
    [...Array(budget).keys()].map((i) => [Math.floor(i / population), i % population]),
  );
  expect(paramsOf(/** @type {Candidate} */ (points[0]))).toMatchObject({
    run: /** @type {any} */ (done.result).run,
    budget,
    population,
  });
  // One step a generation, each followed by the points done.
  expect(steps).toEqual([
    [0, budget, "Searching: generation 1 of 3"],
    [population, budget, null],
    [population, budget, "Searching: generation 2 of 3"],
    [2 * population, budget, null],
    [2 * population, budget, "Searching: generation 3 of 3"],
    [budget, budget, null],
  ]);
});

test("the shown points follow score and distance, and the rest fold under the nearest", async () => {
  const made = await searchApp();
  const { app, sidecar, session } = made;
  scriptRun(sidecar, 13);
  const { scorer, scored } = scripted(app);
  const done = await run(app, searchJob(app, request(made), { makeScorer: scorer }));
  expect(done.error).toBeNull();
  const result = /** @type {any} */ (done.result);

  const expected = shownPoints(
    scored.map((candidate) => {
      const { space, motion } = macrosOf(app, candidate);
      return { id: candidate.id, score: -((space - 0.8) ** 2), embedding: [space, motion, 1] };
    }),
  );
  expect(expected.shown.length).toBeGreaterThan(1);
  expect(result.shown).toEqual(expected.shown);
  const saved = await resultsOf(app, result.run);
  expect(saved.shown).toEqual(expected.shown);
  expect(saved.minDistance).toBe(MIN_SHOWN_DISTANCE);
  expect(saved.foldedUnder).toEqual(Object.fromEntries(expected.foldedUnder));
  expect(result.best).toEqual({
    candidateId: expected.shown[0],
    score: saved.evaluated.find((/** @type {any} */ e) => e.candidateId === expected.shown[0])
      ?.score,
  });

  // The candidates route says which are shown and what each other one folds under.
  const route = SESSION_ROUTES.find(
    (r) => r.method === "GET" && r.path === "/api/sessions/:sessionId/candidates",
  );
  const listed = /** @type {any} */ (
    await route?.handle(
      /** @type {any} */ ({
        app,
        params: { sessionId: String(session.id) },
        query: new URLSearchParams(),
      }),
    )
  );
  const byId = new Map(listed.candidates.map((/** @type {any} */ c) => [c.id, c]));
  expect(byId.get(made.candidate.id).search).toBeNull();
  for (const id of expected.shown) {
    expect(byId.get(id).search).toMatchObject({ shown: true, foldedUnder: null });
  }
  for (const [id, under] of expected.foldedUnder) {
    expect(byId.get(id).search).toMatchObject({ shown: false, foldedUnder: under });
  }
});

test("the control arm makes as many medium nudges from the base, scored, outside the session", async () => {
  const made = await searchApp();
  const { app, sidecar, session } = made;
  const budget = 6;
  scriptRun(sidecar, budget);
  const { scorer, scored } = scripted(app);
  const done = await run(
    app,
    searchJob(app, request(made, { budget, control: true }), { makeScorer: scorer }),
  );
  expect(done.error).toBeNull();
  const result = /** @type {any} */ (done.result);

  const inSession = listSessionCandidates(app.store, session.id);
  expect(inSession.some((c) => c.operator === OPERATOR.optimizeControl)).toBe(false);
  const control = scored.filter((c) => c.operator === OPERATOR.optimizeControl);
  // One child per budgeted point; each is the nudge's first draw that passed.
  expect(control).toHaveLength(budget);
  for (const child of control) {
    expect(child).toMatchObject({
      sessionId: null,
      parentIds: [made.candidate.id],
      operatorParams: expect.objectContaining({ run: result.run, stepSize: "medium" }),
    });
  }
  expect(result.control.candidateIds).toEqual(expect.arrayContaining(control.map((c) => c.id)));
  const saved = await resultsOf(app, result.run);
  expect(saved.control.evaluated.map((/** @type {any} */ e) => e.candidateId)).toEqual(
    control.map((c) => c.id),
  );
  expect(result.control.best.candidateId).toBe(
    [...saved.control.evaluated].sort(
      (/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score,
    )[0].candidateId,
  );
});

test("a cancel during a generation keeps every row stored so far", async () => {
  const made = await searchApp();
  const { app, sidecar, session } = made;
  const budget = population * 3;
  scriptRun(sidecar, budget);
  let batches = 0;
  /** @type {number | undefined} */
  let jobId;
  const { scorer } = scripted(app, {
    onScore: () => {
      if (++batches === 2) app.jobs.cancel(/** @type {number} */ (jobId));
    },
  });
  const status = app.jobs.add(
    "search",
    searchJob(app, request(made, { budget }), { makeScorer: scorer }),
  );
  jobId = status.id;
  await app.jobs.settled(status.id);
  expect(app.jobs.get(status.id).state).toBe("cancelled");
  const points = listSessionCandidates(app.store, session.id).filter(
    (c) => c.operator === OPERATOR.optimize,
  );
  // The first generation was scored and told; the second was stored before its scoring.
  expect(points).toHaveLength(2 * population);
  const tells = (await sidecar.received()).filter((r) => r.request.method === "optimizer_tell");
  expect(tells).toHaveLength(1);
  const run0 = /** @type {string} */ (paramsOf(/** @type {Candidate} */ (points[0]))?.run);
  const saved = await resultsOf(app, run0);
  expect(saved.evaluated).toHaveLength(
    points.filter((c) => paramsOf(c).generation === 0 && c.rejectReason === null).length,
  );
});

test("the estimate is the formula on the last search's median timings, or the bench before any", async () => {
  const made = await searchApp();
  const { app, sidecar } = made;
  expect(await searchEstimate(app.paths.search)).toEqual({
    seconds: BENCH_SECONDS,
    measured: false,
  });
  scriptRun(sidecar, 5);
  const { scorer } = scripted(app, { seconds: { render: 2.5, embed: 0.5 } });
  const done = await run(app, searchJob(app, request(made, { budget: 5 }), { makeScorer: scorer }));
  expect(done.error).toBeNull();
  expect(await searchEstimate(app.paths.search)).toEqual({
    seconds: { render: 2.5, embed: 0.5 },
    measured: true,
  });
});

test("every stored point keeps the vibe's locks, and no locked path is searched", async () => {
  const made = await searchApp();
  const { app, sidecar, session, vibe, candidate } = made;
  const paths = ["macros.brightness", "voices.drone.cutoff", "voices.pad"];
  const locks = paths.map((path) => {
    const taken = lockOn(base, path);
    if (!taken.ok) throw new Error(taken.message);
    setLock(app.store, {
      vibeId: vibe.id,
      candidateId: candidate.id,
      path,
      value: taken.lock.value,
      voiceType: taken.lock.voiceType ?? null,
    });
    return taken.lock;
  });
  const locked = searchSpace(base, locks, constraints, []);
  expect(locked).not.toContain("macros.brightness");
  sidecar.script({ do: "answer", result: { dimension: locked.length } });
  const lockedPopulation = searchPopulation(locked.length);
  for (let g = 0; g < 3; g++) {
    sidecar.script(
      { do: "answer", result: { count: lockedPopulation }, points: { seed: 200 + g, spread: 0.3 } },
      { do: "answer", result: { generations: g + 1 } },
    );
  }
  const { scorer } = scripted(app);
  const done = await run(
    app,
    searchJob(app, request(made, { budget: 3 * lockedPopulation }), { makeScorer: scorer }),
  );
  expect(done.error).toBeNull();
  const start = (await sidecar.received())[0]?.request.params;
  const spec = JSON.parse(readFileSync(String(/** @type {any} */ (start).spec), "utf8"));
  expect(spec.start).toHaveLength(locked.length);
  /** @type {string[]} */
  const wrong = [];
  for (const point of listSessionCandidates(app.store, session.id)) {
    if (point.operator !== OPERATOR.optimize || point.genomeId === null) continue;
    const genome = genomeOf(app, point.genomeId);
    for (const lock of locks) {
      const target = /** @type {NonNullable<ReturnType<typeof parseLockPath>>} */ (
        parseLockPath(lock.path)
      );
      if (sortedJson(readLockTarget(genome, target)) !== sortedJson(lock.value)) {
        wrong.push(`${point.id}: ${lock.path}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

/** The search route's handler, called with a body as the router would. */
async function postSearch(
  /** @type {TestApp["app"]} */ app,
  /** @type {number} */ sessionId,
  /** @type {unknown} */ body,
) {
  const route = SESSION_ROUTES.find(
    (r) => r.method === "POST" && r.path === "/api/sessions/:sessionId/searches",
  );
  if (!route) throw new Error("no search route");
  try {
    return {
      status: 200,
      body: await route.handle(
        /** @type {any} */ ({
          app,
          params: { sessionId: String(sessionId) },
          body: async () => body,
        }),
      ),
    };
  } catch (error) {
    const { status, message, details } = /** @type {any} */ (error);
    if (status === undefined) throw error;
    return { status, body: { error: message, ...details } };
  }
}

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 2, ready: true };
const CODE = { code: "preference-aa" };
const LOOKUP = [
  { do: /** @type {const} */ ("answer"), result: EMBEDDER },
  { do: /** @type {const} */ ("answer"), result: CODE },
];

test("a brief with no taste model is refused with a 409 that says why, and nothing is queued", async () => {
  const made = await searchApp();
  const { app, session, candidate, sidecar } = made;
  const refused = await postSearch(app, session.id, { candidateId: candidate.id });
  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe(
    "This brief has no taste model yet, so a search has nothing to score its points by. Rate some pairs in A/B, then press Fit the taste model on the Model test page.",
  );
  expect(app.jobs.list()).toEqual([]);
  expect(await sidecar.received()).toEqual([]);
});

test("an identical search queued or running is a 409 naming it, and another budget queues", async () => {
  const made = await searchApp();
  const { app, session, candidate, sidecar } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const key = /** @type {string} */ (
    modelPlan(app.store, EMBEDDER.producer, { modelCode: CODE.code }).vibes[0]?.key
  );
  await mkdir(app.paths.models, { recursive: true });
  await writeFile(modelFile(app.paths, key), "{}");
  sidecar.script(...LOOKUP, ...LOOKUP, ...LOOKUP);
  // A job that holds the runner keeps every search queued.
  /** @type {() => void} */
  let release = () => undefined;
  const blocker = app.jobs.add(
    "blocker",
    () => new Promise((resolve) => (release = () => resolve(undefined))),
  );
  const body = { candidateId: candidate.id, budget: 20 };
  const first = await postSearch(app, session.id, body);
  expect(first.status).toBe(200);
  const again = await postSearch(app, session.id, body);
  expect(again).toEqual({
    status: 409,
    body: {
      error: `This session is already running this search (job ${first.body.id}). Wait for it to finish, or cancel it.`,
      jobId: first.body.id,
    },
  });
  expect((await postSearch(app, session.id, { ...body, budget: 30 })).status).toBe(200);
  for (const job of app.jobs.list()) app.jobs.cancel(job.id);
  release();
  await app.jobs.settled(blocker.id);
  await app.jobs.idle();
});

test("a budget outside 1 to 400 or a path that can't be searched is refused", async () => {
  const made = await searchApp();
  const { app, session, candidate } = made;
  for (const budget of [0, 401, 2.5]) {
    const refused = await postSearch(app, session.id, { candidateId: candidate.id, budget });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("budget must be an integer from 1 to 400");
  }
  const macro = await postSearch(app, session.id, {
    candidateId: candidate.id,
    paths: ["macros.space"],
  });
  expect(macro).toMatchObject({ status: 400, body: { error: expect.stringContaining("macro") } });
  const control = await postSearch(app, session.id, { candidateId: candidate.id, control: "yes" });
  expect(control).toMatchObject({
    status: 400,
    body: { error: expect.stringContaining("control") },
  });
});

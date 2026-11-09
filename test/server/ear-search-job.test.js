// The search by ear (decision 0055) against the fake sidecar, with a scripted render in place of
// the engine, so nothing is rendered: an answer is an A/B rating told to the optimizer, a skip
// tells nothing, the next pair is rendered before it is asked for, a rejected point never reaches
// the page, Stop shows the best in the session, and the locks hold.
/** @import { EarView } from "../../src/server/ear-search-job.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { applyLocks } from "../../src/domain/apply-locks.js";
import {
  EAR_DRAWS,
  EAR_IDLE_MS,
  EAR_OPTIMIZER,
  EAR_PHASE,
  EAR_VARIATION,
  MAX_EAR_DIMENSIONS,
  START_STEERING,
} from "../../src/domain/ear-settings.js";
import { parseLockPath, readLockTarget } from "../../src/domain/lock-path.js";
import { OPERATOR } from "../../src/domain/operator.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { searchPaths } from "../../src/domain/search-paths.js";
import { SEARCH_SIGMA } from "../../src/domain/search-settings.js";
import { searchSpace } from "../../src/domain/search-space.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { sortedJson } from "../../src/engine/canonical-genome.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { toVector, vectorPaths } from "../../src/engine/vector-view.js";
import { createEarChannel, earSearchJob, setEarChannel } from "../../src/server/ear-search-job.js";
import {
  addCandidate,
  getGenome,
  listSessionCandidates,
  putGenome,
} from "../../src/server/generation-store.js";
import { setLock } from "../../src/server/lock-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addRatedAudio, addRating, findRatedAudio } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
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

/**
 * A point a little way from `from` in every position, the k-th of its kind.
 * @param {number[]} from
 * @param {number} k
 */
const near = (from, k) => from.map((u) => Math.min(1, Math.max(0, u + 0.004 * k)));

/**
 * A test app with a vibe under cold-dorian's constraints, a session, a base candidate, and the
 * locks `locked` names.
 * @param {string[]} [locked]
 */
async function earApp(locked = []) {
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
  const locks = locked.map((path) => {
    const taken = lockOn(base, path);
    if (!taken.ok) throw new Error(taken.message);
    const { value, voiceType = null } = taken.lock;
    setLock(store, { vibeId: vibe.id, candidateId: candidate.id, path, value, voiceType });
    return taken.lock;
  });
  const start = applyLocks(base, locks).genome;
  const paths = searchSpace(start, locks, constraints, []);
  /** @type {{ genomeId: number, at: number }[]} each excerpt the job asked for, in order */
  const prepared = [];
  let clock = 0;
  /** Which call to `prepare`, counted from 0, throws as a failed render would; none by default. */
  const faults = { at: -1 };
  let calls = 0;
  /** @type {import("../../src/server/ear-search-job.js").Prepare} */
  const prepare = async (app, { genomeId, seed, target }) => {
    if (calls++ === faults.at) throw new Error("the scripted render failed");
    prepared.push({ genomeId, at: clock++ });
    const window = { genomeId, seed, offset: 0, duration: 25, target, producer: PRODUCER };
    return putRender(app.store, { ...window, file: `${genomeId}.mp3`, features: {}, checks: {} })
      .render;
  };
  const tickClock = () => clock++;
  /** @type {string[]} */
  const logged = [];
  made.app.log = (line) => logged.push(line);
  return {
    ...made,
    vibe,
    session,
    candidate,
    start,
    paths,
    prepared,
    prepare,
    tickClock,
    faults,
    logged,
  };
}

/** @typedef {Awaited<ReturnType<typeof earApp>>} EarApp */

/**
 * Scripts one query: its ask, and when `ahead` is given, the four copies' tell and ask, in the
 * job's order: loss, win, tie, skip.
 * @param {TestApp["sidecar"]} sidecar
 * @param {number[][]} asked the points the query's ask gives in turn, a rejected one first when
 *   there are two: each ask after the first follows the tell of a loss
 * @param {{ loss: number[], win: number[], tie: number[], skip: number[] }} [ahead]
 */
function scriptQuery(sidecar, asked, ahead) {
  for (const [i, point] of asked.entries()) {
    if (i > 0) sidecar.script({ do: "answer", result: { generations: 1 } });
    sidecar.script({ do: "answer", result: { count: 1 }, points: [point] });
  }
  if (!ahead) return;
  for (const point of [ahead.loss, ahead.win, ahead.tie, ahead.skip]) {
    sidecar.script(
      { do: "answer", result: { generations: 1 } },
      { do: "answer", result: { count: 1 }, points: [point] },
    );
  }
}

/** The answer's tell, which the real run takes. */
const scriptTell = (/** @type {TestApp["sidecar"]} */ sidecar) =>
  sidecar.script({ do: "answer", result: { generations: 1 } });

/**
 * Starts the job through the runner.
 * @param {EarApp} made
 * @param {number} budget
 */
function startJob(made, budget) {
  const channel = createEarChannel(budget, made.clock);
  const request = {
    vibeId: made.vibe.id,
    sessionId: made.session.id,
    base: made.candidate,
    genome: base,
    budget,
    raw: [],
  };
  const job = earSearchJob(made.app, request, channel, { prepare: made.prepare });
  const status = made.app.jobs.add(OPERATOR.optimizeEar, job);
  setEarChannel(made.app, made.session.id, channel);
  return { channel, status };
}

/**
 * Waits until the view says `until`, a turn of the event loop at a time; throws if the job ends
 * first.
 * @param {ReturnType<typeof createEarChannel>} channel
 * @param {(view: EarView) => boolean} until
 * @returns {Promise<EarView>}
 */
async function waitFor(channel, until) {
  for (;;) {
    const view = channel.view();
    if (until(view)) return view;
    if (view.phase === EAR_PHASE.finished)
      throw new Error(`the job ended first: ${JSON.stringify(view)}`);
    await tick();
  }
}

/**
 * Stores an A/B rating of the view's pair, as `POST …/ab-ratings` would, with the challenger on
 * side `side`.
 * @param {EarApp} made
 * @param {EarView} view
 * @param {"a" | "b" | "tie" | "skip"} outcome
 * @param {"a" | "b"} [side]
 */
function rate(made, view, outcome, side = "a") {
  const { store } = made.app;
  /** @param {{ genomeId: number, seed: number }} heard */
  const sideOf = ({ genomeId, seed }) => {
    const window = { genomeId, seed, offset: 0, duration: 25, engineVersion: ENGINE_VERSION };
    // The best is rated again each query, and its excerpt is kept once.
    const audio =
      findRatedAudio(store, { ...window, target: -16 }) ??
      addRatedAudio(store, {
        ...window,
        target: -16,
        file: `${genomeId}-${seed}.flac`,
        pcmSha256: "0".repeat(64),
        gainDb: 0,
      });
    const ranked = { rank: null, score: null, modelVersion: null, wildcard: null };
    return { ...window, ratedAudioId: audio.id, playedFraction: 1, ...ranked };
  };
  const challenger = /** @type {any} */ (view.challenger);
  const best = /** @type {any} */ (view.best);
  const [a, b] = side === "a" ? [challenger, best] : [best, challenger];
  return addRating(store, {
    sessionId: made.session.id,
    vibeRevisionId: made.vibe.revision.id,
    a: sideOf(a),
    b: sideOf(b),
    leftSide: "a",
    orderSeed: 0,
    outcome,
    timeTakenMs: 1000,
  });
}

/** A request with a JSON body, as the pages send. */
const JSON_REQUEST = { headers: { "content-type": "application/json" }, resume() {} };

/**
 * Calls a session route's handler as the server would.
 * @param {EarApp} made
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {Record<string, unknown>} [body]
 * @param {{ headers: Record<string, string>, resume: () => void }} [request]
 */
async function call(made, method, path, body = {}, request = JSON_REQUEST) {
  const route = SESSION_ROUTES.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return /** @type {any} */ (
    await route.handle(
      /** @type {any} */ ({
        app: made.app,
        params: { sessionId: String(made.session.id) },
        query: new URLSearchParams(),
        request,
        body: async () => body,
      }),
    )
  );
}

const ANSWERS = "/api/sessions/:sessionId/ear-search/answers";
const STOP = "/api/sessions/:sessionId/ear-search/stop";
const STEERING = "/api/sessions/:sessionId/ear-search/steering";

/**
 * The scores each `optimizer_tell` of the real run was given, in order.
 * @param {TestApp["sidecar"]} sidecar
 * @param {string} run
 */
async function toldScores(sidecar, run) {
  return (await sidecar.received())
    .map(({ request }) => /** @type {any} */ (request))
    .filter(({ method, params }) => method === "optimizer_tell" && params.run.endsWith(run))
    .map(({ params }) => JSON.parse(readFileSync(params.scores, "utf8")).scores);
}

test("an answer is a rating told to the optimizer, and the next pair was rendered before it was asked for", async () => {
  const made = await earApp();
  const { app, sidecar, start, paths } = made;
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  const ahead = {
    loss: near(from, 2),
    win: near(from, 3),
    tie: near(from, 4),
    skip: near(from, 5),
  };
  scriptQuery(sidecar, [near(from, 1)], ahead);
  scriptTell(sidecar);
  scriptQuery(sidecar, [ahead.win]);
  scriptTell(sidecar);
  const { channel, status } = startJob(made, 2);

  const first = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  expect(first.best?.id).toBe(made.candidate.id);
  const challenger = /** @type {any} */ (first.challenger);
  const answeredAt = made.tickClock();
  // The challenger is on side b and won.
  const rating = rate(made, first, "b", "b");
  // The reply carries the next pair, so the page asks for nothing more.
  /** @type {EarView} */
  const second = await call(made, "POST", ANSWERS, { query: 0, ratingId: rating.id });
  expect(second).toMatchObject({ phase: EAR_PHASE.listening, query: 1 });
  expect(second.best?.id).toBe(challenger.id);
  const nextGenome = /** @type {any} */ (second.challenger).genomeId;
  // Rendered while the owner listened to the first pair, and only fetched from the cache since.
  const firstRender = made.prepared.find((p) => p.genomeId === nextGenome);
  expect(firstRender?.at).toBeLessThan(answeredAt);
  // The last query renders nothing ahead: the budget ends there.
  expect(second.ready).toBe(0);
  await call(made, "POST", ANSWERS, { query: 1, ratingId: rate(made, second, "tie").id });
  await app.jobs.settled(status.id);
  const done = app.jobs.get(status.id);
  expect(done.error).toBeNull();
  const result = /** @type {any} */ (done.result);
  expect(result).toMatchObject({ answered: 2, stopped: false, best: challenger.id });
  expect(await toldScores(sidecar, result.run)).toEqual([[1], [0.5]]);
  const spec = JSON.parse(readFileSync(`${app.paths.search}/${result.run}/spec.json`, "utf8"));
  expect(spec).toMatchObject({ optimizer: EAR_OPTIMIZER, start: from });
});

test("steering sent while a pair plays reaches the spec before the next draw, and each point records it (0075)", async () => {
  const made = await earApp();
  const { app, sidecar, start, paths } = made;
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  const ahead = {
    loss: near(from, 2),
    win: near(from, 3),
    tie: near(from, 4),
    skip: near(from, 5),
  };
  scriptQuery(sidecar, [near(from, 1)], ahead);
  scriptTell(sidecar);
  scriptQuery(sidecar, [near(from, 6)]);
  scriptTell(sidecar);
  const { channel, status } = startJob(made, 2);
  const [first, second] = paths;
  const readSpec = (/** @type {string} */ run) =>
    JSON.parse(readFileSync(`${app.paths.search}/${run}/spec.json`, "utf8"));

  const pair = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  expect(pair).toMatchObject({ paths, steering: START_STEERING });
  const run = /** @type {any} */ (listSessionCandidates(app.store, made.session.id).at(-1))
    .operatorParams.run;
  expect(readSpec(run).settings).toEqual({
    sigma: SEARCH_SIGMA,
    draws: EAR_DRAWS,
    reach: EAR_VARIATION.wide,
    drift: paths.map(() => 0),
  });
  const shift = { [`${first}`]: -0.5, [`${second}`]: 1 };
  const steered = await call(made, "POST", STEERING, { variation: "wider", shift });
  expect(steered.steering).toEqual({ variation: "wider", shift });
  await call(made, "POST", ANSWERS, { query: 0, ratingId: rate(made, pair, "skip").id });
  const next = await waitFor(channel, (v) => v.query === 1 && v.phase === EAR_PHASE.listening);
  expect(readSpec(run).settings).toMatchObject({
    reach: EAR_VARIATION.wider,
    drift: paths.map((path) => shift[path] ?? 0),
  });
  const stored = listSessionCandidates(app.store, made.session.id).filter(
    (c) => c.operator === OPERATOR.optimizeEar,
  );
  expect(stored.map((c) => /** @type {any} */ (c.operatorParams).steering)).toEqual([
    START_STEERING,
    { variation: "wider", shift },
  ]);
  await expect(call(made, "POST", STEERING, { variation: "huge", shift: {} })).rejects.toThrow(
    /variation must be one of/,
  );
  await expect(
    call(made, "POST", STEERING, { variation: "wide", shift: { nowhere: 1 } }),
  ).rejects.toThrow(/names nowhere, which this search doesn't move/);
  await call(made, "POST", ANSWERS, { query: 1, ratingId: rate(made, next, "skip").id });
  await app.jobs.settled(status.id);
  expect(app.jobs.get(status.id).error).toBeNull();
  await expect(call(made, "POST", STEERING, { variation: "wide", shift: {} })).rejects.toThrow(
    /has ended/,
  );
});

test("a skip tells the optimizer nothing, and a loss keeps the best", async () => {
  const made = await earApp();
  const { app, sidecar, start, paths } = made;
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  const ahead = {
    loss: near(from, 2),
    win: near(from, 3),
    tie: near(from, 4),
    skip: near(from, 5),
  };
  scriptQuery(sidecar, [near(from, 1)], ahead);
  scriptTell(sidecar);
  const later = {
    loss: near(from, 6),
    win: near(from, 7),
    tie: near(from, 8),
    skip: near(from, 9),
  };
  scriptQuery(sidecar, [ahead.skip], later);
  scriptTell(sidecar);
  scriptQuery(sidecar, [later.loss]);
  scriptTell(sidecar);
  const { channel, status } = startJob(made, 3);

  const first = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  await call(made, "POST", ANSWERS, { query: 0, ratingId: rate(made, first, "skip").id });
  const second = await waitFor(channel, (v) => v.query === 1 && v.ready === 4);
  expect(second.best?.id).toBe(made.candidate.id);
  // The challenger is on side a, and b, the best, won.
  await call(made, "POST", ANSWERS, { query: 1, ratingId: rate(made, second, "b").id });
  const third = await waitFor(channel, (v) => v.query === 2 && v.phase === EAR_PHASE.listening);
  expect(third.best?.id).toBe(made.candidate.id);
  await call(made, "POST", ANSWERS, { query: 2, ratingId: rate(made, third, "a").id });
  await app.jobs.settled(status.id);
  const result = /** @type {any} */ (app.jobs.get(status.id).result);
  expect(await toldScores(sidecar, result.run)).toEqual([[null], [0], [1]]);
  expect(result.best).toBe(/** @type {any} */ (third.challenger).id);
});

test("a rejected point is stored, told as a loss and never reaches the page", async () => {
  const made = await earApp();
  const { app, sidecar, start, paths } = made;
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  // The base's own position repeats the base, so the linter's chain rejects it.
  scriptQuery(sidecar, [from, near(from, 1)]);
  scriptTell(sidecar);
  const { channel, status } = startJob(made, 1);

  /** @type {EarView[]} */
  const views = [];
  const asking = await waitFor(channel, (v) => {
    views.push(v);
    return v.phase === EAR_PHASE.listening;
  });
  const stored = listSessionCandidates(app.store, made.session.id).filter(
    (c) => c.operator === OPERATOR.optimizeEar,
  );
  expect(stored.map((c) => c.rejectReason)).toEqual([REJECT_REASON.repeated, null]);
  const [rejected, valid] = stored;
  expect(asking.challenger?.id).toBe(valid?.id);
  expect(views.every((v) => v.challenger?.id !== rejected?.id)).toBe(true);
  // Never rendered.
  expect(made.prepared.map((p) => p.genomeId)).not.toContain(rejected?.genomeId);
  await call(made, "POST", ANSWERS, { query: 0, ratingId: rate(made, asking, "skip").id });
  await app.jobs.settled(status.id);
  const result = /** @type {any} */ (app.jobs.get(status.id).result);
  expect(await toldScores(sidecar, result.run)).toEqual([[0], [null]]);
});

test("an answer must be a live rating of the pair asked, while it is asked", async () => {
  const made = await earApp();
  const { sidecar, start, paths } = made;
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  scriptQuery(sidecar, [near(from, 1)]);
  const { channel } = startJob(made, 1);
  const view = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening);
  const rating = rate(made, view, "a");
  await expect(call(made, "POST", ANSWERS, { query: 1, ratingId: rating.id })).rejects.toThrow(
    "query must be",
  );
  const other = rate(made, { ...view, best: view.challenger }, "a");
  await expect(call(made, "POST", ANSWERS, { query: 0, ratingId: other.id })).rejects.toThrow(
    "is not of pair 1",
  );
  await expect(call(made, "POST", ANSWERS, { query: 0, ratingId: 999 })).rejects.toThrow(
    "no live A/B rating 999",
  );
  await call(made, "POST", STOP);
  await waitFor(channel, (v) => v.stopped);
});

test("Stop ends the run with its best shown in the session and every other point folded under it", async () => {
  const made = await earApp();
  const { app, sidecar, start, paths } = made;
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  const ahead = {
    loss: near(from, 2),
    win: near(from, 3),
    tie: near(from, 4),
    skip: near(from, 5),
  };
  scriptQuery(sidecar, [near(from, 1)], ahead);
  scriptTell(sidecar);
  const later = {
    loss: near(from, 6),
    win: near(from, 7),
    tie: near(from, 8),
    skip: near(from, 9),
  };
  scriptQuery(sidecar, [ahead.win], later);
  const { channel, status } = startJob(made, 20);
  const first = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  await call(made, "POST", ANSWERS, { query: 0, ratingId: rate(made, first, "a").id });
  await waitFor(channel, (v) => v.query === 1 && v.ready === 4);
  const stopped = await call(made, "POST", STOP);
  expect(stopped.stopped).toBe(true);
  await app.jobs.settled(status.id);
  const done = app.jobs.get(status.id);
  expect(done.state).toBe("done");
  const winner = /** @type {any} */ (first.challenger).id;
  expect(done.result).toMatchObject({ answered: 1, stopped: true, best: winner });
  expect(channel.view()).toMatchObject({ phase: EAR_PHASE.finished, challenger: null });

  const listed = await call(made, "GET", "/api/sessions/:sessionId/candidates");
  const points = listed.candidates.filter(
    (/** @type {any} */ c) => c.operator === OPERATOR.optimizeEar,
  );
  expect(points).toHaveLength(2);
  for (const point of points) {
    expect(point.search).toMatchObject(
      point.id === winner
        ? { shown: true, foldedUnder: null }
        : { shown: false, foldedUnder: winner },
    );
  }
});

/** A macro, a voice parameter (a trajectory) and a whole voice, as acceptance 3 asks. */
const LOCKED = ["macros.brightness", "voices.drone.cutoff", "voices.pad"];

test("locks hold: a locked macro is not searched and every point keeps it", async () => {
  const made = await earApp(LOCKED);
  const { app, sidecar, start, paths } = made;
  expect(paths).not.toContain("macros.brightness");
  const from = toVector(start, paths);
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  const ahead = {
    loss: near(from, 2),
    win: near(from, 3),
    tie: near(from, 4),
    skip: near(from, 5),
  };
  scriptQuery(sidecar, [near(from, -3)], ahead);
  scriptTell(sidecar);
  scriptQuery(sidecar, [ahead.loss]);
  scriptTell(sidecar);
  const { channel, status } = startJob(made, 2);
  const first = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  await call(made, "POST", ANSWERS, { query: 0, ratingId: rate(made, first, "b").id });
  const second = await waitFor(channel, (v) => v.query === 1 && v.phase === EAR_PHASE.listening);
  await call(made, "POST", ANSWERS, { query: 1, ratingId: rate(made, second, "b").id });
  await app.jobs.settled(status.id);
  expect(app.jobs.get(status.id).error).toBeNull();
  // Every genome the job stored or rendered, the copies' included.
  const ids = new Set(made.prepared.map((p) => p.genomeId));
  expect(ids.size).toBeGreaterThan(4);
  for (const id of ids) {
    const genome = getGenome(app.store, id)?.genome;
    for (const path of LOCKED) {
      const target = /** @type {NonNullable<ReturnType<typeof parseLockPath>>} */ (
        parseLockPath(path)
      );
      expect(sortedJson(readLockTarget(genome, target))).toBe(
        sortedJson(readLockTarget(base, target)),
      );
    }
  }
});

test("the route refuses a space over 12 dimensions and a second search by ear in the session", async () => {
  const made = await earApp();
  const { paths, start } = made;
  const raw = searchPaths(start, [], constraints, vectorPaths(start))
    .filter((path) => !path.startsWith("macros."))
    .slice(0, MAX_EAR_DIMENSIONS - paths.length + 1);
  const route = "/api/sessions/:sessionId/ear-searches";
  await expect(
    call(made, "POST", route, { candidateId: made.candidate.id, paths: raw }),
  ).rejects.toThrow(`at most ${MAX_EAR_DIMENSIONS} dimensions`);
  // Held at the first ask, so the first search stays unfinished.
  made.sidecar.script({ do: "answer", result: { dimension: paths.length } }, { do: "hang" });
  const first = await call(made, "POST", route, { candidateId: made.candidate.id });
  await expect(call(made, "POST", route, { candidateId: made.candidate.id })).rejects.toThrow(
    `already searching by ear (job ${first.id})`,
  );
  made.app.jobs.cancel(first.id);
  await made.app.jobs.settled(first.id);
});

/** Waits until `holds` is true, a turn of the event loop at a time. */
async function until(/** @type {() => boolean} */ holds) {
  while (!holds()) await tick();
}

/** The copies of the answers still in the run's folder. */
const forksLeft = (/** @type {EarApp} */ made) =>
  readdirSync(join(made.app.paths.search, "run-1")).filter((name) => name.startsWith("branch-"));

/** Scripts a run that asks one pair, with its four copies, and starts it. */
function oneAsked(/** @type {EarApp} */ made, /** @type {number} */ budget) {
  const from = toVector(made.start, made.paths);
  made.sidecar.script({ do: "answer", result: { dimension: made.paths.length } });
  const ahead = {
    loss: near(from, 2),
    win: near(from, 3),
    tie: near(from, 4),
    skip: near(from, 5),
  };
  scriptQuery(made.sidecar, [near(from, 1)], budget > 1 ? ahead : undefined);
  return startJob(made, budget);
}

test("a pair left with no choice for the idle time stops the search as Stop does, its best kept", async () => {
  const made = await earApp();
  const { channel, status } = oneAsked(made, 3);
  await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  await made.clock.waitForTimer(EAR_IDLE_MS);
  made.clock.advance(EAR_IDLE_MS);
  await made.app.jobs.settled(status.id);
  const done = made.app.jobs.get(status.id);
  expect(done.state).toBe("done");
  expect(done.result).toMatchObject({ answered: 0, stopped: true, best: made.candidate.id });
  expect(channel.view()).toMatchObject({ phase: EAR_PHASE.finished, stopped: true, idle: true });
  expect(forksLeft(made)).toEqual([]);
});

test("a cancel while the owner listens removes the run's copies before the job ends", async () => {
  const made = await earApp();
  const { channel, status } = oneAsked(made, 3);
  await waitFor(channel, (v) => v.phase === EAR_PHASE.listening && v.ready === 4);
  expect(forksLeft(made)).toHaveLength(4);
  made.app.jobs.cancel(status.id);
  await made.app.jobs.settled(status.id);
  expect(made.app.jobs.get(status.id).state).toBe("cancelled");
  expect(channel.view()).toMatchObject({
    phase: EAR_PHASE.finished,
    error: "The search was cancelled.",
  });
  expect(forksLeft(made)).toEqual([]);
});

test("a render ahead that fails is logged and dropped, and the run draws the next pair itself", async () => {
  const made = await earApp();
  const { app, sidecar, start, paths } = made;
  const from = toVector(start, paths);
  // The base, the first pair's new point, then the first copy's point, which fails.
  made.faults.at = 2;
  sidecar.script({ do: "answer", result: { dimension: paths.length } });
  scriptQuery(sidecar, [near(from, 1)]);
  sidecar.script(
    { do: "answer", result: { generations: 1 } },
    { do: "answer", result: { count: 1 }, points: [near(from, 2)] },
  );
  scriptTell(sidecar);
  scriptQuery(sidecar, [near(from, 2)]);
  scriptTell(sidecar);
  const { channel, status } = startJob(made, 2);
  const first = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening);
  await until(() => made.logged.length === 1);
  expect(made.logged[0]).toMatch(/stopped rendering ahead of pair 0: the scripted render failed/);
  expect(channel.view().ready).toBe(0);
  // The challenger is on side a, and b, the best, won.
  const second = await call(made, "POST", ANSWERS, {
    query: 0,
    ratingId: rate(made, first, "b").id,
  });
  expect(second).toMatchObject({ phase: EAR_PHASE.listening, query: 1 });
  await call(made, "POST", ANSWERS, { query: 1, ratingId: rate(made, second, "tie").id });
  await app.jobs.settled(status.id);
  const done = app.jobs.get(status.id);
  expect(done.error).toBeNull();
  expect(await toldScores(sidecar, /** @type {any} */ (done.result).run)).toEqual([[0], [0.5]]);
});

test("a second post of one choice, racing the first, is a 409", async () => {
  const made = await earApp();
  const { channel, status } = oneAsked(made, 1);
  scriptTell(made.sidecar);
  const view = await waitFor(channel, (v) => v.phase === EAR_PHASE.listening);
  const ratingId = rate(made, view, "a").id;
  const first = call(made, "POST", ANSWERS, { query: 0, ratingId });
  const second = call(made, "POST", ANSWERS, { query: 0, ratingId });
  await expect(second).rejects.toMatchObject({ status: 409 });
  await first;
  await made.app.jobs.settled(status.id);
  expect(made.app.jobs.get(status.id).result).toMatchObject({ answered: 1 });
});

test("the page's closing beacon stops the search, and a text body from another site is a 403", async () => {
  const made = await earApp();
  const { channel, status } = oneAsked(made, 1);
  await waitFor(channel, (v) => v.phase === EAR_PHASE.listening);
  /** @param {string} origin */
  const beacon = (origin) => ({
    headers: { "content-type": "text/plain;charset=UTF-8", origin, host: "127.0.0.1:4180" },
    resume() {},
  });
  await expect(
    call(made, "POST", STOP, {}, beacon("http://elsewhere.example")),
  ).rejects.toMatchObject({ status: 403 });
  expect(channel.view().stopped).toBe(false);
  const stopped = await call(made, "POST", STOP, {}, beacon("http://127.0.0.1:4180"));
  expect(stopped.stopped).toBe(true);
  await made.app.jobs.settled(status.id);
  expect(made.app.jobs.get(status.id).result).toMatchObject({ answered: 0, stopped: true });
});

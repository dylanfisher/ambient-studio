// The optimizer test's routes (decision 0059) through the HTTP server. No brief here has a taste
// model, so a start is refused before any job is added and nothing starts the sidecar; the
// reading routes are checked over a stored test and ratings seeded in the store, so nothing is
// rendered.
/** @import { Studio } from "../support/studio.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { abOrder } from "../../src/domain/ab-order.js";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { OPTIMIZER_TEST, OWNER_INCONCLUSIVE, VERDICT } from "../../src/domain/optimizer-report.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import { addEvaluation, EVALUATION_KIND } from "../../src/server/evaluation-store.js";
import { addCandidate, getGenome, putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addRatedAudio, addRating } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
import { GENOMES, removeStudio, startStudio } from "../support/studio.js";

/** A seeded candidate's fields beside its brief, session and genome. */
const SEEDED = Object.freeze({
  generationId: null,
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

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

test("a start whose every brief has no taste model is refused, saying why, before any job", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { vibe } = await studio.openSession();
  const reply = await studio.server.api("POST", "/api/optimizer-tests", {
    vibes: [{ vibeId: vibe.id }],
  });
  expect(reply.status).toBe(409);
  expect(reply.json().error).toMatch(
    /^No chosen brief can be tested\. cold drone: This brief has no taste model yet/,
  );
  expect(studio.server.jobs.list()).toEqual([]);
});

test("a start names its briefs and bases, at most 3 bases in open sessions", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { vibe, session } = await studio.openSession();
  /** @param {unknown} body */
  const post = (body) => studio.server.api("POST", "/api/optimizer-tests", body);
  expect((await post({ vibes: [] })).status).toBe(400);
  expect((await post({ vibes: [{ vibeId: vibe.id + 1 }] })).status).toBe(400);
  expect((await post({ vibes: [{ vibeId: vibe.id }, { vibeId: vibe.id }] })).status).toBe(400);
  expect((await post({ vibes: [{ vibeId: vibe.id, candidateIds: [1, 2, 3, 4] }] })).status).toBe(
    400,
  );
  expect((await post({ vibes: [{ vibeId: vibe.id }], budget: 0 })).status).toBe(400);
  const { store } = studio.server;
  const base = addCandidate(store, {
    ...SEEDED,
    vibeRevisionId: vibe.revision.id,
    sessionId: session.id,
    genomeId: putGenome(store, vibe.id, GENOMES[0]).id,
  });
  await studio.ok("POST", `/api/sessions/${session.id}/stop`, {});
  const stopped = await post({ vibes: [{ vibeId: vibe.id, candidateIds: [base.id] }] });
  expect(stopped.status).toBe(409);
  expect(stopped.json().error).toMatch(/isn't in an open session/);
});

test("a second start while a test is unfinished is refused with its id", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { vibe } = await studio.openSession();
  const running = studio.server.jobs.add(
    "optimizer-test",
    ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  );
  const reply = await studio.server.api("POST", "/api/optimizer-tests", {
    vibes: [{ vibeId: vibe.id }],
  });
  expect(reply.status).toBe(409);
  expect(reply.json()).toMatchObject({ jobId: running.id });
  const { job } = await studio.ok("GET", "/api/optimizer-tests");
  expect(job).toMatchObject({ id: running.id });
});

test("a stored test is read with the owner's spot-check choices, and a session lists its pairs", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { vibe, session } = await studio.openSession();
  const { store } = studio.server;
  const revision = vibe.revision.id;
  /** @param {number} n a genome variant and the candidate made of it */
  const seeded = (n) => {
    const genomeId = putGenome(store, vibe.id, { ...GENOMES[0], reverbDecay: 1 + n / 10 }).id;
    return addCandidate(store, {
      ...SEEDED,
      vibeRevisionId: revision,
      sessionId: n % 2 === 0 ? session.id : null,
      genomeId,
      source: "optimizer",
      operator: n % 2 === 0 ? "optimize" : "optimize-control",
    });
  };
  const pairs = [0, 1].map((p) => {
    const search = seeded(2 * p);
    const control = seeded(2 * p + 1);
    /** @param {typeof search} c */
    const heard = (c) => ({
      candidateId: c.id,
      genomeId: /** @type {number} */ (c.genomeId),
      seed: c.seed,
    });
    return {
      run: "run-1",
      rank: p + 1,
      sessionId: session.id,
      orderSeed: 11 + p,
      search: heard(search),
      control: heard(control),
    };
  });
  const { paths } = studio.server;
  await mkdir(paths.renderCache, { recursive: true });
  /** @param {{ genomeId: number, seed: number }} heard */
  const cache = async ({ genomeId, seed }) => {
    const genome = getGenome(store, genomeId)?.genome;
    const offset = excerptOffset(/** @type {any} */ (genome), seed, EXCERPT_SECONDS);
    const file = `seeded-${genomeId}.mp3`;
    await writeFile(join(paths.renderCache, file), "");
    const key = {
      genomeId,
      seed,
      offset,
      duration: EXCERPT_SECONDS,
      target: -16,
      producer: PRODUCER,
    };
    return putRender(store, { ...key, file, features: {}, checks: [] }).render;
  };
  const second = /** @type {(typeof pairs)[number]} */ (pairs[1]);
  const searchRender = await cache(second.search);
  const controlRender = await cache(second.control);
  const stored = addEvaluation(store, {
    params: { kind: EVALUATION_KIND.optimizer, budget: 4, runs: OPTIMIZER_TEST.runs },
    report: { createdAt: 1, vibes: [{ vibeId: vibe.id, name: "cold drone", spotChecks: pairs }] },
  });
  // A generation run isn't an optimizer test.
  addEvaluation(store, { params: { count: 1 }, report: { overall: {} } });

  // The owner chose the search's side of the first pair, shown where its seed put it.
  const [first] = pairs;
  if (!first) throw new Error("no pair");
  /** @param {{ genomeId: number, seed: number }} side @param {number} n */
  const side = (side, n) => {
    const window = { seed: side.seed, offset: 0, duration: 25, engineVersion: 1 };
    const rated = addRatedAudio(store, {
      ...window,
      genomeId: side.genomeId,
      target: -16,
      file: `rated-${n}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    return {
      ...window,
      genomeId: side.genomeId,
      ratedAudioId: rated.id,
      playedFraction: 1,
      rank: null,
      score: null,
      modelVersion: null,
      wildcard: null,
    };
  };
  const rating = addRating(store, {
    sessionId: session.id,
    vibeRevisionId: revision,
    a: side(first.search, 1),
    b: side(first.control, 2),
    leftSide: abOrder(first.orderSeed),
    orderSeed: first.orderSeed,
    outcome: "a",
    timeTakenMs: 1000,
  });
  // The stored rating holds the pair's session and its sides as the seed drew them.
  expect(rating).toMatchObject({ sessionId: session.id, leftSide: abOrder(first.orderSeed) });

  const listed = await studio.ok("GET", "/api/optimizer-tests");
  expect(listed.tests.map((/** @type {any} */ t) => t.id)).toEqual([stored.id]);
  expect(listed.estimate).toMatchObject({ measured: false });
  const [tested] = listed.tests[0].report.vibes;
  expect(tested.owner).toMatchObject({
    wins: 1,
    losses: 0,
    decided: 1,
    unrated: 1,
    p: null,
    verdict: VERDICT.inconclusive,
  });
  expect(OWNER_INCONCLUSIVE).toMatch(/waiting on data/);
  expect(tested.sessions).toEqual([{ sessionId: session.id, unrated: 1 }]);

  const spot = await studio.ok("GET", `/api/sessions/${session.id}/spot-checks`);
  expect(spot).toMatchObject({ sessionId: session.id, stopped: false });
  expect(spot.pairs.map((/** @type {any} */ p) => [p.rank, p.rated])).toEqual([
    [1, true],
    [2, false],
  ]);
  // The first pair's excerpts aren't cached, so it has nothing to play.
  expect(spot.pairs[0]).toMatchObject({ evaluationId: stored.id, pair: null, a: null, b: null });
  // The search is side a, and the stored seed says which side is on the left.
  expect(spot.pairs[1]).toMatchObject({
    pair: {
      a: searchRender.id,
      b: controlRender.id,
      orderSeed: second.orderSeed,
      leftSide: abOrder(second.orderSeed),
    },
    a: { id: second.search.candidateId, excerpt: { url: `/audio/${searchRender.id}` } },
    b: { id: second.control.candidateId, excerpt: { url: `/audio/${controlRender.id}` } },
  });
  expect((await studio.server.api("GET", "/api/sessions/999/spot-checks")).status).toBe(404);
  // The generation runs' route doesn't serve an optimizer test.
  expect((await studio.server.api("GET", `/api/evaluations/${stored.id}`)).status).toBe(404);
});

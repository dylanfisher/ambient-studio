// A session's ranking under its brief's taste model (decision 0046), against the fake sidecar,
// whose `predict` scores each excerpt by its spectral centroid. Candidates and their excerpts
// are seeded in the store, so nothing is rendered.
/** @import { TestApp } from "../support/test-app.js" */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putEmbedding } from "../../src/server/embedding-store.js";
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { modelFile, modelPlan } from "../../src/server/preference-model.js";
import { writePreferenceTest } from "../../src/server/preference-test-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { vibeLoudness } from "../../src/server/render-excerpt.js";
import { putRender } from "../../src/server/render-store.js";
import { rankSession, readRanking } from "../../src/server/session-ranking.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";
import { features } from "../support/training-rows.js";

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 2, ready: true };
const CODE = { code: "preference-aa" };
const LOOKUP = [
  { do: /** @type {const} */ ("answer"), result: EMBEDDER },
  { do: /** @type {const} */ ("answer"), result: CODE },
];
/** The fake scores by the spectral centroid, which `features` sets to 100 Hz times an id. */
const CENTROID = FEATURE_NAMES.findIndex(({ name }) => name === "centroidMean");

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

const signal = () => new AbortController().signal;

/**
 * A test app whose config names a checkpoint folder, with a session of one candidate per
 * centroid, each at its own seed with an embedded excerpt whose centroid is 100 Hz times it.
 * @param {number[]} centroids
 */
async function setup(centroids) {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const { store, paths } = app;
  const vibe = createVibe(store, VIBE);
  const session = startSession(store, vibe.id);
  await mkdir(paths.renderCache, { recursive: true });
  const renders = [];
  for (const [i, centroid] of centroids.entries()) {
    const genome = putGenome(store, vibe.id, droneGenome);
    const seed = i + 1;
    addCandidate(store, {
      generationId: null,
      vibeRevisionId: vibe.revision.id,
      sessionId: session.id,
      genomeId: genome.id,
      seed,
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
    const file = `seeded-${seed}.mp3`;
    await writeFile(join(paths.renderCache, file), "");
    const { render } = putRender(store, {
      genomeId: genome.id,
      seed,
      offset: excerptOffset(droneGenome, seed, EXCERPT_SECONDS),
      duration: EXCERPT_SECONDS,
      target: vibeLoudness(VIBE.constraints),
      producer: PRODUCER,
      file,
      features: features([centroid]).get(centroid),
      checks: { ok: true, findings: [] },
    });
    putEmbedding(store, {
      ratedAudioId: null,
      renderId: render.id,
      producer: EMBEDDER.producer,
      vector: new Uint8Array(new Float32Array([i, 1]).buffer),
    });
    renders.push(render);
  }
  return { ...made, vibe, session, renders };
}

/** Writes a model file under the vibe's current key; the fake never reads it. */
async function writeModel(/** @type {TestApp["app"]} */ app) {
  const key = /** @type {string} */ (
    modelPlan(app.store, EMBEDDER.producer, { modelCode: CODE.code }).vibes[0]?.key
  );
  const file = modelFile(app.paths, key);
  await mkdir(app.paths.models, { recursive: true });
  await writeFile(file, "{}");
  return key;
}

test("with no model file at all, nothing is ranked and the sidecar is never asked", async () => {
  const { app, session, sidecar } = await setup([1, 2]);
  // The taste model test's report shares the folder, and is no model.
  await writePreferenceTest(app.paths, { vibes: [] });
  expect(await rankSession(app, session, signal())).toEqual({ ranked: 0, notRanked: null });
  expect(await readRanking(app.paths, session.id)).toBeNull();
  expect(await sidecar.received()).toEqual([]);
});

test("the order follows the scores, and a wildcard comes from the bottom half", async () => {
  // Nine excerpts, so one wildcard, in slot 4.
  const centroids = [3, 9, 1, 7, 5, 2, 8, 4, 6];
  const { app, session, sidecar, renders } = await setup(centroids);
  const key = await writeModel(app);
  sidecar.script(...LOOKUP, {
    do: "answer",
    result: { count: 9 },
    scores: { feature: CENTROID, variance: 1 },
  });

  expect(await rankSession(app, session, signal())).toEqual({ ranked: 9, notRanked: null });
  const ranking = await readRanking(app.paths, session.id);
  expect(ranking?.modelKey).toBe(key);
  const excerpts = ranking?.excerpts ?? [];
  expect(excerpts.map((e) => e.renderId)).toEqual(renders.map((r) => r.id));
  expect(excerpts.map((e) => e.score)).toEqual(centroids.map((c) => 100 * c));
  expect(excerpts.map((e) => e.rank)).toEqual(centroids.map((c) => 10 - c));
  const wild = excerpts.filter((e) => e.wildcard);
  expect(wild).toHaveLength(1);
  expect(wild[0]?.rank).toBeGreaterThan(5);
  expect(wild[0]?.slot).toBe(4);
  const methods = (await sidecar.received()).map(({ request }) => request.method);
  expect(methods).toEqual(["embedder", "preference_code", "predict"]);
});

test("the ranking keeps the full covariance predict wrote, for the pair picker", async () => {
  const { app, session, sidecar } = await setup([1, 2, 3]);
  await writeModel(app);
  const covariance = [
    [4, 3.9, 0],
    [3.9, 4, 0],
    [0, 0, 1],
  ];
  sidecar.script(...LOOKUP, {
    do: "answer",
    result: { count: 3 },
    scores: { feature: CENTROID, variance: 0, covariance },
  });
  await rankSession(app, session, signal());
  expect((await readRanking(app.paths, session.id))?.covariance).toEqual(covariance);
});

test("a model with no terms ranks nothing, and the session's old ranking goes", async () => {
  const { app, session, sidecar } = await setup([1, 2]);
  await writeModel(app);
  const scored = { do: /** @type {const} */ ("answer"), result: { count: 2 } };
  sidecar.script(...LOOKUP, { ...scored, scores: { feature: CENTROID, variance: 1 } }, ...LOOKUP, {
    ...scored,
    scores: { feature: CENTROID, variance: 0 },
  });
  await rankSession(app, session, signal());
  expect(await readRanking(app.paths, session.id)).not.toBeNull();
  const result = await rankSession(app, session, signal());
  expect(result.ranked).toBe(0);
  expect(result.notRanked).toMatch(/nothing to tell the candidates apart/);
  expect(await readRanking(app.paths, session.id)).toBeNull();
});

test("a model under an older key ranks nothing and asks for no prediction", async () => {
  const { app, session, sidecar } = await setup([1, 2]);
  await mkdir(app.paths.models, { recursive: true });
  await writeFile(join(app.paths.models, "older-key.json"), "{}");
  sidecar.script(...LOOKUP);
  const result = await rankSession(app, session, signal());
  expect(result).toEqual({ ranked: 0, notRanked: expect.stringMatching(/out of date/) });
  const methods = (await sidecar.received()).map(({ request }) => request.method);
  expect(methods).toEqual(["embedder", "preference_code"]);
});

test("a sidecar failure in predict fails loudly, never leaving the session unranked silently", async () => {
  const { app, session, sidecar } = await setup([1, 2]);
  await writeModel(app);
  sidecar.script(...LOOKUP, { do: "error", error: "the model file doesn't match" });
  await expect(rankSession(app, session, signal())).rejects.toThrow(
    /ranking the candidates failed: .*the model file doesn't match/,
  );
  expect(existsSync(join(app.paths.rankings, `${session.id}.json`))).toBe(false);
});

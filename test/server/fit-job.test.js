// The fit job (decision 0044) run directly against the fake sidecar, over rows seeded by hand:
// what it writes for the sidecar, which keys it fits, which it keeps, and what it reports.
/** @import { TestApp } from "../support/test-app.js" */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { putEmbedding } from "../../src/server/embedding-store.js";
import { fitInput, fitJob } from "../../src/server/fit-job.js";
import { putGenome } from "../../src/server/generation-store.js";
import { HYPERPARAMETERS, modelFile, modelPlan } from "../../src/server/preference-model.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addFeedback, addRatedAudio, addRating } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { heardExcerpt } from "../support/temp-store.js";
import { testApp } from "../support/test-app.js";
import { features } from "../support/training-rows.js";

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 4, ready: true };
const FITTED = { pairs: 1, thumbs: 1, items: 2, clapDimension: 1, iterations: 5 };
const unranked = { rank: null, score: null, modelVersion: null, wildcard: null };
const TARGET = -16;

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

/**
 * A test app whose config names a checkpoint folder, with two vibes. The first has excerpts x
 * and y, embedded, and z, not embedded; x beat y, x tied z, and x has a thumbs up. The second
 * has no ratings.
 */
async function setup() {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const { store } = app;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const empty = createVibe(store, { name: "w", brief: "b", constraints: {}, softTargets: {} });
  const session = startSession(store, vibe.id);
  const common = { sessionId: session.id, vibeRevisionId: vibe.revision.id };

  /** @param {number} brightness @param {number[] | null} vector */
  const excerpt = (brightness, vector) => {
    const genome = putGenome(store, vibe.id, {
      ...droneGenome,
      macros: { ...droneGenome.macros, brightness },
    });
    const heard = { ...heardExcerpt(genome.id), engineVersion: ENGINE_VERSION };
    const audio = addRatedAudio(store, {
      ...heard,
      target: TARGET,
      file: `${genome.id}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    const { engineVersion: _, ...window } = heard;
    putRender(store, {
      ...window,
      target: TARGET,
      producer: PRODUCER,
      file: `${genome.id}.wav`,
      features: features([audio.id]).get(audio.id),
      checks: {},
    });
    if (vector) {
      putEmbedding(store, {
        ratedAudioId: audio.id,
        renderId: null,
        producer: EMBEDDER.producer,
        vector: new Uint8Array(new Float32Array(vector).buffer),
      });
    }
    return { ...heard, ratedAudioId: audio.id, playedFraction: 1 };
  };
  const x = excerpt(0.2, [1, 0, 0, 0]);
  const y = excerpt(0.8, [0, 1, 0, 0]);
  const z = excerpt(0.5, null);
  /** @param {typeof x} a @param {typeof x} b @param {"a" | "b" | "tie"} outcome */
  const rate = (a, b, outcome) =>
    addRating(store, {
      ...common,
      a: { ...a, ...unranked },
      b: { ...b, ...unranked },
      leftSide: "b",
      orderSeed: 1,
      outcome,
      timeTakenMs: 1,
    });
  const win = rate(x, y, "a");
  const tie = rate(x, z, "tie");
  const up = addFeedback(store, {
    ...common,
    ...x,
    timeTakenMs: 1,
    kind: "thumbs",
    direction: "up",
    note: null,
    macro: null,
    macroValue: null,
  });
  return { ...made, vibe, empty, x, y, z, win, tie, up };
}

const job = () => ({ signal: new AbortController().signal, progress: () => undefined });

/**
 * Every fit request the fake received, in order.
 * @param {TestApp["sidecar"]} sidecar
 */
const fits = async (sidecar) =>
  (await sidecar.received())
    .map(({ request }) => /** @type {{ method: string, params: { set: string } }} */ (request))
    .filter(({ method }) => method === "fit");

// The fake writes `floats` to the request's `out`, so an empty list leaves an empty model file.
const fitted = { do: /** @type {const} */ ("answer"), result: FITTED, floats: [] };

test("leaves out a rating whose excerpt has no embedding, and lists it", async () => {
  const { app, vibe, empty, x, z, win, tie, up } = await setup();
  const plan = modelPlan(app.store, EMBEDDER.producer);
  const [first, second] = plan.vibes;
  expect(first?.vibeId).toBe(vibe.id);
  expect(first?.set.pairs.map((p) => p.ratingId)).toEqual([win.id]);
  expect(first?.set.thumbs.map((t) => [t.feedbackId, t.item.ratedAudioId])).toEqual([
    [up.id, x.ratedAudioId],
  ]);
  // One entry for the tie, though it is two half-weighted pairs.
  expect(first?.unembedded).toEqual([{ ratingId: tie.id, ratedAudioId: z.ratedAudioId }]);
  expect(second).toMatchObject({ vibeId: empty.id, unembedded: [] });
  expect(second?.set.pairs).toEqual([]);
  expect(plan.global.set.pairs.map((p) => p.ratingId)).toEqual([win.id]);
  expect(plan.global.hyperparameters).toEqual(HYPERPARAMETERS);
});

test("a vibe's key names the global model, so another vibe's rating changes it", async () => {
  const { app, empty } = await setup();
  const before = modelPlan(app.store, EMBEDDER.producer);
  expect(before.vibes[1]?.hyperparameters).toEqual({
    ...HYPERPARAMETERS,
    globalModel: before.global.key,
  });
  // Removing the first vibe's thumbs changes the global set, so the second vibe's prior.
  app.store.db.prepare("UPDATE feedback SET removedAt = 1, removedReason = 'test'").run();
  const after = modelPlan(app.store, EMBEDDER.producer);
  expect(after.global.key).not.toBe(before.global.key);
  expect(after.vibes[1]?.vibeId).toBe(empty.id);
  expect(after.vibes[1]?.key).not.toBe(before.vibes[1]?.key);
});

test("the sidecar's input holds each excerpt once, by index, with its embedding row", async () => {
  const { app, x, y } = await setup();
  const plan = modelPlan(app.store, EMBEDDER.producer);
  const planned = /** @type {NonNullable<typeof plan.vibes[0]>} */ (plan.vibes[0]);
  const { set, embeddings } = fitInput(app.store, planned.set, {
    embeddingProducer: EMBEDDER.producer,
    dimension: EMBEDDER.dimension,
    hyperparameters: planned.hyperparameters,
    prior: "/data/models/global.json",
    embeddingsPath: "/data/.fit-1/embeddings.f32",
  });
  expect(set).toMatchObject({
    hyperparameters: planned.hyperparameters,
    featureNames: FEATURE_NAMES.map(({ name }) => name),
    macroNames: Object.keys(MACROS),
    embeddingDimension: 4,
    embeddings: "/data/.fit-1/embeddings.f32",
    prior: "/data/models/global.json",
    // x won from the right, since the rating showed side b on the left.
    pairs: [{ winner: 0, loser: 1, weight: 1, winnerLeft: false }],
    thumbs: [{ item: 0, up: true }],
  });
  const items = /** @type {{ features: unknown[], macros: number[] }[]} */ (set.items);
  expect(items).toHaveLength(2);
  const centroid = FEATURE_NAMES.findIndex(({ name }) => name === "centroidMean");
  expect(items.map((item) => item.features[centroid])).toEqual([
    100 * x.ratedAudioId,
    100 * y.ratedAudioId,
  ]);
  const brightness = Object.keys(MACROS).indexOf("brightness");
  expect(items[0]?.macros[brightness]).toBeCloseTo(0.2, 12);
  expect([...new Float32Array(embeddings.buffer)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0]);
});

test("fits the global model, then each vibe's on it, and stores each under its key", async () => {
  const { app, sidecar, vibe, empty } = await setup();
  sidecar.script({ do: "answer", result: EMBEDDER }, fitted, fitted, fitted);
  /** @type {[number, number, string | null][]} */
  const reports = [];
  const result = await fitJob(app)({
    signal: new AbortController().signal,
    progress: (done, total, step) => reports.push([done, total, step]),
  });

  const plan = modelPlan(app.store, EMBEDDER.producer);
  const [asked] = (await sidecar.received()).map(({ request }) => request);
  expect(asked).toMatchObject({ method: "embedder", params: { fetch: false } });
  expect(await fits(sidecar)).toHaveLength(3);
  for (const key of [plan.global.key, ...plan.vibes.map((v) => v.key)]) {
    expect(existsSync(modelFile(app.paths, key))).toBe(true);
  }
  // The temp folders are gone, and only the model files remain.
  expect((await readdir(app.config.dataRoot)).filter((name) => name.startsWith(".fit-"))).toEqual(
    [],
  );
  expect(result.global).toMatchObject({ key: plan.global.key, kept: false, ratings: 1 });
  expect(result.vibes).toEqual([
    {
      vibeId: vibe.id,
      key: plan.vibes[0]?.key,
      kept: false,
      ratings: 1,
      ties: 0,
      thumbs: 1,
      unembedded: 1,
      missing: 0,
      summary:
        "Fitted on 1 A/B choices and 1 thumbs; 1 rated excerpts left out because their sound isn't analyzed yet; run the embed job.",
    },
    {
      vibeId: empty.id,
      key: plan.vibes[1]?.key,
      kept: false,
      ratings: 0,
      ties: 0,
      thumbs: 0,
      unembedded: 0,
      missing: 0,
      summary: "No ratings to fit, so it predicts from the model over every brief.",
    },
  ]);
  expect(reports).toEqual([
    [0, 0, "Checking that every rated excerpt's sound is analyzed"],
    [0, 3, "Learning your taste across every brief"],
    [1, 3, "Learning your taste for brief 1 of 2"],
    [2, 3, "Learning your taste for brief 2 of 2"],
    [3, 3, null],
  ]);
});

test("a vibe's set names the global model's file as its prior, and a cancel stops it", async () => {
  const { app, sidecar } = await setup();
  // The job deletes each set once it is fitted, so the vibe's fit hangs to be read in flight.
  sidecar.script({ do: "answer", result: EMBEDDER }, fitted, { do: "hang" });
  const controller = new AbortController();
  const running = fitJob(app)({ signal: controller.signal, progress: () => undefined });
  await sidecar.waitForReceived(3);
  const [global, first] = await fits(sidecar);
  const read = async (/** @type {string | undefined} */ path) =>
    JSON.parse(await readFile(/** @type {string} */ (path), "utf8"));
  const plan = modelPlan(app.store, EMBEDDER.producer);
  expect((await read(first?.params.set)).prior).toBe(modelFile(app.paths, plan.global.key));
  expect(global?.params.set).not.toBe(first?.params.set);
  controller.abort();
  await expect(running).rejects.toThrow("sidecar request fit was cancelled");
  expect(existsSync(modelFile(app.paths, /** @type {string} */ (plan.vibes[0]?.key)))).toBe(false);
});

test("a second run keeps every model whose key hasn't changed", async () => {
  const { app, sidecar } = await setup();
  sidecar.script({ do: "answer", result: EMBEDDER }, fitted, fitted, fitted);
  await fitJob(app)(job());
  sidecar.script({ do: "answer", result: EMBEDDER });
  const again = await fitJob(app)(job());
  expect(await fits(sidecar)).toHaveLength(3);
  expect(again.global.kept).toBe(true);
  expect(again.vibes.map((v) => v.kept)).toEqual([true, true]);
});

test("a vibe with thumbs alone says the left/right lean stays at its prior", async () => {
  const { app, sidecar, win } = await setup();
  app.store.db.prepare("UPDATE ratings SET removedAt = 1, removedReason = 'test'").run();
  expect(win.id).toBeGreaterThan(0);
  sidecar.script({ do: "answer", result: EMBEDDER }, fitted, fitted, fitted);
  const result = await fitJob(app)(job());
  expect(result.vibes[0]?.summary).toBe(
    "Fitted on 0 A/B choices and 1 thumbs; with no A/B choices, the left/right lean stays at its prior.",
  );
});

test("a sidecar failure fails the job naming the model, and leaves no file", async () => {
  const { app, sidecar } = await setup();
  sidecar.script({ do: "answer", result: EMBEDDER }, fitted, {
    do: "error",
    error: "fit raised ArithmeticError: no step",
  });
  await expect(fitJob(app)(job())).rejects.toThrow(
    "fitting brief 1 failed: sidecar request fit failed: fit raised ArithmeticError: no step",
  );
  const plan = modelPlan(app.store, EMBEDDER.producer);
  expect(existsSync(modelFile(app.paths, plan.global.key))).toBe(true);
  expect(existsSync(modelFile(app.paths, /** @type {string} */ (plan.vibes[0]?.key)))).toBe(false);
});

test("with no checkpoint folder the job fails at once, asking the sidecar nothing", async () => {
  const { app, sidecar } = await setup();
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache: null } };
  await expect(fitJob(app)(job())).rejects.toThrow(NO_CHECKPOINT_CACHE);
  expect(await sidecar.received()).toEqual([]);
});

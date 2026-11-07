// The fit job (decision 0044) run directly against the fake sidecar, over rows seeded by hand:
// what it writes for the sidecar, which keys it fits, which it keeps, and what it reports.
/** @import { TestApp } from "../support/test-app.js" */
/** @import { ModelPlan } from "../../src/server/preference-model.js" */
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
const CODE = { code: "preference-aa" };
const FITTED = { pairs: 1, thumbs: 1, items: 2, clapDimension: 1, iterations: 5 };
const unranked = { rank: null, score: null, modelVersion: null, wildcard: null };
const TARGET = -16;
// The embedding of the excerpt only the held-out session rated, found in no other row.
const HELD_OUT_VECTOR = [0, 0, 0, 7];

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

/**
 * A test app whose config names a checkpoint folder, with three vibes. In the first, session 1
 * has excerpts x and y, embedded, and z, not embedded; x beat y, x tied z, x beat z, and x has
 * a thumbs up. Session 2 of the first vibe rated w, rated nowhere else, against y, and gave w a
 * thumbs down. The second vibe has one rating of its own, u beat v; the third has none.
 */
async function setup() {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const { store } = app;
  /** @param {string} name */
  const brief = (name) => createVibe(store, { name, brief: "b", constraints: {}, softTargets: {} });
  const vibe = brief("v");
  const other = brief("o");
  const empty = brief("w");
  const session = startSession(store, vibe.id);
  const later = startSession(store, vibe.id);
  const elsewhere = startSession(store, other.id);

  /** @param {number} vibeId @param {number} brightness @param {number[] | null} vector */
  const excerpt = (vibeId, brightness, vector) => {
    const genome = putGenome(store, vibeId, {
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
  const x = excerpt(vibe.id, 0.2, [1, 0, 0, 0]);
  const y = excerpt(vibe.id, 0.8, [0, 1, 0, 0]);
  const z = excerpt(vibe.id, 0.5, null);
  const w = excerpt(vibe.id, 0.6, HELD_OUT_VECTOR);
  const u = excerpt(other.id, 0.3, [0, 0, 1, 0]);
  const v = excerpt(other.id, 0.7, [0, 0, 1, 1]);
  /**
   * @param {{ id: number }} at the session
   * @param {number} vibeRevisionId
   */
  const rater = (at, vibeRevisionId) => {
    const common = { sessionId: at.id, vibeRevisionId };
    return {
      /** @param {typeof x} a @param {typeof x} b @param {"a" | "b" | "tie"} outcome */
      rate: (a, b, outcome) =>
        addRating(store, {
          ...common,
          a: { ...a, ...unranked },
          b: { ...b, ...unranked },
          leftSide: "b",
          orderSeed: 1,
          outcome,
          timeTakenMs: 1,
        }),
      /** @param {typeof x} heard @param {"up" | "down"} direction */
      thumbs: (heard, direction) =>
        addFeedback(store, {
          ...common,
          ...heard,
          timeTakenMs: 1,
          kind: "thumbs",
          direction,
          note: null,
          macro: null,
          macroValue: null,
        }),
    };
  };
  const first = rater(session, vibe.revision.id);
  const win = first.rate(x, y, "a");
  const tie = first.rate(x, z, "tie");
  const again = first.rate(x, z, "a");
  const up = first.thumbs(x, "up");
  const held = rater(later, vibe.revision.id);
  const heldRating = held.rate(w, y, "a");
  held.thumbs(w, "down");
  const theirs = rater(elsewhere, other.revision.id).rate(u, v, "a");
  return {
    ...made,
    vibe,
    other,
    empty,
    later,
    x,
    y,
    z,
    w,
    win,
    tie,
    again,
    up,
    heldRating,
    theirs,
  };
}

const job = () => ({ signal: new AbortController().signal, progress: () => undefined });
const plan = (
  /** @type {TestApp["app"]} */ app,
  heldOutSession = /** @type {number | null} */ (null),
) => modelPlan(app.store, EMBEDDER.producer, { modelCode: CODE.code, heldOutSession });

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
const start = [
  { do: /** @type {const} */ ("answer"), result: EMBEDDER },
  { do: /** @type {const} */ ("answer"), result: CODE },
];

/** @param {TestApp["app"]} app */
const temps = async (app) =>
  (await readdir(app.config.dataRoot)).filter((name) => name.startsWith(".fit-"));

/**
 * Every set file the plan's fits would read, as the job writes them.
 * @param {TestApp["app"]} app
 * @param {ModelPlan} planned
 */
const inputs = (app, planned) =>
  planned.vibes.flatMap(({ prior, ...vibe }) =>
    [
      { model: prior, prior: null, basisItems: prior.basisItems },
      { model: vibe, prior: "/data/prior.json", basisItems: [] },
    ].map(({ model, prior: priorPath, basisItems }) =>
      fitInput(app.store, model.set, {
        embeddingProducer: EMBEDDER.producer,
        dimension: EMBEDDER.dimension,
        hyperparameters: model.hyperparameters,
        prior: priorPath,
        embeddingsPath: "/data/.fit-1/embeddings.f32",
        basisItems,
      }),
    ),
  );

/**
 * Each item's spectral centroid in a set file, which `features` makes 100 times its rated
 * audio id.
 * @param {Record<string, unknown>} set
 */
const centroids = (set) => {
  const index = FEATURE_NAMES.findIndex(({ name }) => name === "centroidMean");
  return /** @type {{ features: unknown[] }[]} */ (set.items).map((item) => item.features[index]);
};

test("leaves out a rating whose excerpt has no embedding, listing each excerpt once", async () => {
  const made = await setup();
  const { app, vibe, other, empty, x, z, win, tie, again, up, heldRating } = made;
  const [first, second, third] = plan(app).vibes;
  expect(first?.vibeId).toBe(vibe.id);
  expect(first?.set.pairs.map((p) => p.ratingId)).toEqual([win.id, heldRating.id]);
  expect(first?.set.thumbs.map((t) => t.feedbackId)[0]).toBe(up.id);
  expect(first?.set.thumbs[0]?.item.ratedAudioId).toBe(x.ratedAudioId);
  // One entry per rating and excerpt: the tie's two halves make one.
  expect(first?.unembedded).toEqual([
    { ratingId: tie.id, ratedAudioId: z.ratedAudioId },
    { ratingId: again.id, ratedAudioId: z.ratedAudioId },
  ]);
  expect(second).toMatchObject({ vibeId: other.id, unembedded: [] });
  expect(third).toMatchObject({ vibeId: empty.id, unembedded: [] });
  expect(third?.set.pairs).toEqual([]);
});

test("each vibe's prior is fitted on every other vibe's ratings, under its own key", async () => {
  const { app, vibe, win, heldRating, theirs } = await setup();
  const [first, second, third] = plan(app).vibes;
  expect(first?.prior.set.pairs.map((p) => p.ratingId)).toEqual([theirs.id]);
  expect(second?.prior.set.pairs.map((p) => p.ratingId)).toEqual([win.id, heldRating.id]);
  expect(third?.prior.set.pairs.map((p) => p.ratingId)).toEqual([win.id, heldRating.id, theirs.id]);
  for (const planned of [first, second, third]) {
    expect(planned?.hyperparameters).toEqual({
      ...HYPERPARAMETERS,
      modelCode: CODE.code,
      globalModel: planned?.prior.key,
    });
  }
  expect(new Set([first, second, third].map((p) => p?.prior.key)).size).toBe(3);
  // The basis is every vibe's excerpts, so each prior reads the same items.
  const basis = first?.prior.basisItems.map((item) => item.ratedAudioId);
  expect(second?.prior.basisItems.map((item) => item.ratedAudioId)).toEqual(basis);
  expect(basis).toHaveLength(5);
  expect(vibe.id).toBe(first?.vibeId);
});

/** @param {TestApp["app"]} app @param {number} ratingId */
const removeRating = (app, ratingId) =>
  app.store.db
    .prepare("UPDATE ratings SET removedAt = 1, removedReason = 'test' WHERE id = ?")
    .run(ratingId);

test("with one vibe holding every rating, its prior has no ratings but a basis", async () => {
  const { app, sidecar, theirs, x } = await setup();
  removeRating(app, theirs.id);
  const [first] = plan(app).vibes;
  expect(first?.prior.set.pairs).toEqual([]);
  expect(first?.prior.set.thumbs).toEqual([]);
  expect(first?.prior.basisItems.map((item) => item.ratedAudioId)).toContain(x.ratedAudioId);

  sidecar.script(...start, ...Array(6).fill(fitted));
  const result = await fitJob(app)(job());
  expect(result.vibes[0]?.summary).toBe(
    "Fitted on 2 A/B choices and 2 thumbs; no other brief has ratings, so it starts from the base prior; 1 rated excerpts left out because their sound isn't analyzed yet; run the embed job.",
  );
  expect(result.vibes[0]).toMatchObject({ priorRatings: 0, priorThumbs: 0, unembedded: 1 });
});

test("a fold leaves the held-out session out of every set and basis its fits read", async () => {
  const { app, later, w, heldRating } = await setup();
  const fold = plan(app, later.id);
  for (const planned of fold.vibes) {
    for (const set of [planned.set, planned.prior.set]) {
      expect(set.pairs.map((p) => p.ratingId)).not.toContain(heldRating.id);
      expect([...set.pairs, ...set.thumbs].map((row) => row.sessionId)).not.toContain(later.id);
    }
    const ids = planned.prior.basisItems.map((item) => item.ratedAudioId);
    expect(ids).not.toContain(w.ratedAudioId);
  }
  const held = new Float32Array(HELD_OUT_VECTOR);
  for (const { set, embeddings } of inputs(app, fold)) {
    const floats = new Float32Array(embeddings.buffer);
    for (let row = 0; row < floats.length; row += EMBEDDER.dimension) {
      expect([...floats.slice(row, row + EMBEDDER.dimension)]).not.toEqual([...held]);
    }
    expect(centroids(set)).not.toContain(100 * w.ratedAudioId);
  }
  // Without the fold, the same files carry it.
  const whole = inputs(app, plan(app)).flatMap(({ set }) => centroids(set));
  expect(whole).toContain(100 * w.ratedAudioId);
  expect(fold.vibes[0]?.key).not.toBe(plan(app).vibes[0]?.key);
});

test("the sidecar's input holds each excerpt once, by index, with its embedding row", async () => {
  const { app, x, y, later } = await setup();
  const [planned] = plan(app, later.id).vibes;
  const vibe = /** @type {NonNullable<typeof planned>} */ (planned);
  const { set, embeddings } = fitInput(app.store, vibe.set, {
    embeddingProducer: EMBEDDER.producer,
    dimension: EMBEDDER.dimension,
    hyperparameters: vibe.hyperparameters,
    prior: "/data/models/prior.json",
    embeddingsPath: "/data/.fit-1/embeddings.f32",
  });
  expect(set).toMatchObject({
    hyperparameters: vibe.hyperparameters,
    featureNames: FEATURE_NAMES.map(({ name }) => name),
    macroNames: Object.keys(MACROS),
    embeddingDimension: 4,
    embeddings: "/data/.fit-1/embeddings.f32",
    prior: "/data/models/prior.json",
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

test("a prior's input lists every basis item first, whether or not its pairs name it", async () => {
  const { app } = await setup();
  const [planned] = plan(app).vibes;
  const prior = /** @type {NonNullable<typeof planned>} */ (planned).prior;
  const { set } = fitInput(app.store, prior.set, {
    embeddingProducer: EMBEDDER.producer,
    dimension: EMBEDDER.dimension,
    hyperparameters: prior.hyperparameters,
    prior: null,
    embeddingsPath: "/data/.fit-1/embeddings.f32",
    basisItems: prior.basisItems,
  });
  expect(/** @type {unknown[]} */ (set.items)).toHaveLength(prior.basisItems.length);
  expect(set.pairs).toHaveLength(1);
});

test("fits each vibe's prior, then the vibe on it, and stores each under its key", async () => {
  const { app, sidecar, vibe, other, empty } = await setup();
  sidecar.script(...start, ...Array(6).fill(fitted));
  /** @type {[number, number, string | null][]} */
  const reports = [];
  const result = await fitJob(app)({
    signal: new AbortController().signal,
    progress: (done, total, step) => reports.push([done, total, step]),
  });

  const planned = plan(app);
  const asked = (await sidecar.received()).map(({ request }) => request);
  expect(asked[0]).toMatchObject({ method: "embedder", params: { fetch: false } });
  expect(asked[1]).toMatchObject({ method: "preference_code", params: {} });
  expect(await fits(sidecar)).toHaveLength(6);
  for (const { key, prior } of planned.vibes) {
    expect(existsSync(modelFile(app.paths, key))).toBe(true);
    expect(existsSync(modelFile(app.paths, prior.key))).toBe(true);
  }
  expect(await temps(app)).toEqual([]);
  expect(result.vibes.map((v) => v.vibeId)).toEqual([vibe.id, other.id, empty.id]);
  expect(result.vibes[0]).toEqual({
    vibeId: vibe.id,
    key: planned.vibes[0]?.key,
    kept: false,
    priorKey: planned.vibes[0]?.prior.key,
    priorKept: false,
    ratings: 2,
    ties: 0,
    thumbs: 2,
    priorRatings: 1,
    priorThumbs: 0,
    unembedded: 1,
    missing: 0,
    summary:
      "Fitted on 2 A/B choices and 2 thumbs; 1 rated excerpts left out because their sound isn't analyzed yet; run the embed job.",
  });
  expect(result.vibes[2]?.summary).toBe(
    "No ratings to fit, so it predicts from the model over the other briefs.",
  );
  expect(reports).toEqual([
    [0, 0, "Checking that every rated excerpt's sound is analyzed"],
    [0, 3, "Learning your taste for brief 1 of 3"],
    [1, 3, "Learning your taste for brief 2 of 3"],
    [2, 3, "Learning your taste for brief 3 of 3"],
    [3, 3, null],
  ]);
});

test("a vibe's set names its prior's file, and a cancel leaves no temp folder", async () => {
  const { app, sidecar } = await setup();
  // The job deletes each set once it is fitted, so the vibe's fit hangs to be read in flight.
  sidecar.script(...start, fitted, { do: "hang" });
  const controller = new AbortController();
  const running = fitJob(app)({ signal: controller.signal, progress: () => undefined });
  await sidecar.waitForReceived(4);
  const [prior, first] = await fits(sidecar);
  const read = async (/** @type {string | undefined} */ path) =>
    JSON.parse(await readFile(/** @type {string} */ (path), "utf8"));
  const [planned] = plan(app).vibes;
  const priorKey = /** @type {string} */ (planned?.prior.key);
  expect((await read(first?.params.set)).prior).toBe(modelFile(app.paths, priorKey));
  expect(prior?.params.set).not.toBe(first?.params.set);
  expect(await temps(app)).toHaveLength(1);
  controller.abort();
  await expect(running).rejects.toThrow("sidecar request fit was cancelled");
  expect(existsSync(modelFile(app.paths, /** @type {string} */ (planned?.key)))).toBe(false);
  expect(await temps(app)).toEqual([]);
});

test("a second run keeps every model whose key hasn't changed", async () => {
  const { app, sidecar } = await setup();
  sidecar.script(...start, ...Array(6).fill(fitted));
  await fitJob(app)(job());
  sidecar.script(...start);
  const again = await fitJob(app)(job());
  expect(await fits(sidecar)).toHaveLength(6);
  expect(again.vibes.map((v) => [v.kept, v.priorKept])).toEqual([
    [true, true],
    [true, true],
    [true, true],
  ]);
});

test("another model code changes every key", async () => {
  const { app } = await setup();
  const before = plan(app);
  const after = modelPlan(app.store, EMBEDDER.producer, { modelCode: "preference-bb" });
  for (const [i, planned] of before.vibes.entries()) {
    expect(after.vibes[i]?.key).not.toBe(planned.key);
    expect(after.vibes[i]?.prior.key).not.toBe(planned.prior.key);
  }
});

test("a vibe with thumbs alone says the left/right lean stays at its prior", async () => {
  const { app, sidecar } = await setup();
  app.store.db.prepare("UPDATE ratings SET removedAt = 1, removedReason = 'test'").run();
  sidecar.script(...start, ...Array(6).fill(fitted));
  const result = await fitJob(app)(job());
  expect(result.vibes[0]?.summary).toBe(
    "Fitted on 0 A/B choices and 2 thumbs; with no A/B choices, the left/right lean stays at its prior; no other brief has ratings, so it starts from the base prior.",
  );
});

test("a sidecar failure fails the job naming the model, and leaves no file", async () => {
  const { app, sidecar } = await setup();
  sidecar.script(...start, fitted, {
    do: "error",
    error: "fit raised ArithmeticError: no step",
  });
  const [planned] = plan(app).vibes;
  await expect(fitJob(app)(job())).rejects.toThrow(
    `fitting brief ${planned?.vibeId} failed: sidecar request fit failed: fit raised ArithmeticError: no step`,
  );
  expect(existsSync(modelFile(app.paths, /** @type {string} */ (planned?.prior.key)))).toBe(true);
  expect(existsSync(modelFile(app.paths, /** @type {string} */ (planned?.key)))).toBe(false);
});

test("with no checkpoint folder the job fails at once, asking the sidecar nothing", async () => {
  const { app, sidecar } = await setup();
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache: null } };
  await expect(fitJob(app)(job())).rejects.toThrow(NO_CHECKPOINT_CACHE);
  expect(await sidecar.received()).toEqual([]);
});

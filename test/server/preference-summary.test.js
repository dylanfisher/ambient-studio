// The brief page's taste summary read from the model files (decision 0047), against the fake
// sidecar: no model, a stale one, and the current one with the ratings it rests on.
/** @import { TestApp } from "../support/test-app.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { putEmbedding } from "../../src/server/embedding-store.js";
import { putGenome } from "../../src/server/generation-store.js";
import { modelFile, modelPlan } from "../../src/server/preference-model.js";
import { readPreferenceSummary } from "../../src/server/preference-summary.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addRatedAudio, addRating } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { heardExcerpt } from "../support/temp-store.js";
import { testApp } from "../support/test-app.js";
import { features } from "../support/training-rows.js";

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 2, ready: true };
const CODE = { code: "preference-aa" };
const answers = [
  { do: /** @type {const} */ ("answer"), result: EMBEDDER },
  { do: /** @type {const} */ ("answer"), result: CODE },
];
// A model file with one macro term, enough for the text; the summary reads nothing else here.
const MODEL = {
  featureNames: [],
  macroNames: ["motion"],
  terms: ["macro:motion", "leftBias", "thumbsIntercept"],
  mean: [1, 0, 0],
  covariance: [
    [0.01, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  basis: { featureScales: [], macroScales: [1] },
};

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

/**
 * A test app whose config names a checkpoint folder, with one vibe whose first session has
 * x beat y and x tie y, and whose second session has y beat x: three A/B choices over two
 * sessions.
 */
async function setup() {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const { store } = app;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  /** @param {number} brightness */
  const excerpt = (brightness) => {
    const genome = putGenome(store, vibe.id, {
      ...droneGenome,
      macros: { ...droneGenome.macros, brightness },
    });
    const heard = { ...heardExcerpt(genome.id), engineVersion: ENGINE_VERSION };
    const audio = addRatedAudio(store, {
      ...heard,
      target: -16,
      file: `${genome.id}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    const { engineVersion: _, ...window } = heard;
    putRender(store, {
      ...window,
      target: -16,
      producer: PRODUCER,
      file: `${genome.id}.wav`,
      features: features([audio.id]).get(audio.id),
      checks: {},
    });
    putEmbedding(store, {
      ratedAudioId: audio.id,
      renderId: null,
      producer: EMBEDDER.producer,
      vector: new Uint8Array(new Float32Array([brightness, 1]).buffer),
    });
    return { ...heard, ratedAudioId: audio.id, playedFraction: 1 };
  };
  const x = excerpt(0.2);
  const y = excerpt(0.8);
  const unranked = { rank: null, score: null, modelVersion: null, wildcard: null };
  const first = startSession(store, vibe.id);
  const second = startSession(store, vibe.id);
  for (const [session, outcome] of /** @type {const} */ ([
    [first, "a"],
    [first, "tie"],
    [second, "b"],
  ])) {
    addRating(store, {
      sessionId: session.id,
      vibeRevisionId: vibe.revision.id,
      a: { ...x, ...unranked },
      b: { ...y, ...unranked },
      leftSide: "a",
      orderSeed: 1,
      outcome,
      timeTakenMs: 1,
    });
  }
  return { ...made, vibe };
}

/** The current key of the app's only vibe, as the fit job would plan it. */
const currentKey = (/** @type {TestApp["app"]} */ app) =>
  /** @type {string} */ (
    modelPlan(app.store, EMBEDDER.producer, { modelCode: CODE.code }).vibes[0]?.key
  );

/** @param {string} path @param {unknown} value */
async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

const signal = () => new AbortController().signal;

test("with no model file at all it says there is no model yet and asks the sidecar nothing", async () => {
  const { app, vibe, sidecar } = await setup();
  const summary = await readPreferenceSummary(app, vibe.id, signal());
  expect(summary.state).toBe("none");
  expect(summary.text).toMatch(/^No taste model yet\. .*fit job/);
  expect(await sidecar.received()).toEqual([]);
});

test("with no checkpoint folder it says why there is no model", async () => {
  const { app, vibe } = await setup();
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache: null } };
  await writeJson(modelFile(app.paths, "other"), MODEL);
  const summary = await readPreferenceSummary(app, vibe.id, signal());
  expect(summary.text).toContain(`No taste model yet: ${NO_CHECKPOINT_CACHE}.`);
});

test("a model file under another key is out of date, never shown as current", async () => {
  const { app, vibe, sidecar } = await setup();
  sidecar.script(...answers);
  await writeJson(modelFile(app.paths, "an-older-key"), MODEL);
  const summary = await readPreferenceSummary(app, vibe.id, signal());
  expect(summary.state).toBe("stale");
  expect(summary.text).toMatch(/^The taste model is out of date/);
  expect(summary.text).not.toContain("move more");
});

test("the current model's text rests on its A/B choices, a tie counted once, and sessions", async () => {
  const { app, vibe, sidecar } = await setup();
  sidecar.script(...answers);
  await writeJson(modelFile(app.paths, currentKey(app)), MODEL);
  const summary = await readPreferenceSummary(app, vibe.id, signal());
  expect(summary.state).toBe("fitted");
  expect(summary.text).toContain("rests on 3 A/B choices over 2 sessions, and needs 37 more");
  const methods = (await sidecar.received()).map(({ request }) => request.method);
  expect(methods).toEqual(["embedder", "preference_code"]);
});

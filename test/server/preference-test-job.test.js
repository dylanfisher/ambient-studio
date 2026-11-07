// The taste model test (decision 0045) run directly against the fake sidecar, over ratings
// seeded by hand. The fake's `predict` scores each excerpt by one of its features, so a test
// sets the model's calls through the features it writes and counts the agreement by hand.
/** @import { TestApp } from "../support/test-app.js" */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { agreement, credit } from "../../src/domain/preference-report.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putEmbedding } from "../../src/server/embedding-store.js";
import { putGenome } from "../../src/server/generation-store.js";
import { HYPERPARAMETERS, modelFile, modelPlan } from "../../src/server/preference-model.js";
import { preferenceTestJob } from "../../src/server/preference-test-job.js";
import { readPreferenceTest } from "../../src/server/preference-test-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addFeedback, addRatedAudio, addRating } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { heardExcerpt } from "../support/temp-store.js";
import { testApp } from "../support/test-app.js";

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 4, ready: true };
const CODE = { code: "preference-aa" };
const FITTED = { pairs: 1, thumbs: 0, items: 2, clapDimension: 0, iterations: 5 };
const unranked = { rank: null, score: null, modelVersion: null, wildcard: null };
const TARGET = -16;

/** @param {string} name */
const featureIndex = (name) => FEATURE_NAMES.findIndex((entry) => entry.name === name);
// The full model scores by the spectral centroid, the features-only one by the loudness range.
const MODEL_SCORES = { feature: featureIndex("centroidMean"), variance: 1 };
const FEATURES_SCORES = { feature: featureIndex("loudnessRange"), variance: 1 };

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

/**
 * What one excerpt measured: `taste` is its centroid, `range` its loudness range, and its
 * loudest 3 s as heard is `loudest + gain`.
 * @typedef {{ taste: number, range: number, loudest: number, gain: number }} Measures
 */

/** Session excerpts 0 to 4: taste rises with the index, the range falls, 4 is the loudest. */
const MEASURES = /** @type {Measures[]} */ ([
  { taste: 1, range: 9, loudest: -13, gain: 0 },
  { taste: 2, range: 8, loudest: -12, gain: 0 },
  { taste: 3, range: 7, loudest: -12, gain: 0 },
  { taste: 4, range: 6, loudest: -12, gain: 0 },
  { taste: 5, range: 5, loudest: -12, gain: 1 },
]);

// Winner first, by index into the session's excerpts. AGREE's winner has the higher taste.
const AGREE = [
  [4, 0],
  [4, 1],
  [4, 2],
  [4, 3],
  [3, 0],
  [3, 1],
  [3, 2],
  [2, 0],
  [2, 1],
  [1, 0],
  [4, 0],
  [3, 0],
];
/**
 * Each session's decided ratings, and how many of them the full model gets right by hand:
 * 12 of 14, 10 of 13 and 7 of 14.
 */
const SESSIONS = [
  { decided: [...AGREE, [0, 4], [1, 3]], agreed: 12 },
  { decided: [...AGREE.slice(0, 10), [0, 4], [1, 3], [2, 4]], agreed: 10 },
  {
    decided: [...AGREE.slice(0, 7), [0, 4], [1, 4], [2, 4], [3, 4], [0, 3], [1, 3], [2, 3]],
    agreed: 7,
  },
];

/**
 * A test app with a checkpoint folder and two vibes. The first has three sessions of five
 * excerpts each, rated as `SESSIONS` says, with the winner on the left in every other rating.
 * Session 2 also has a tie, and a thumbs on an extra excerpt that session 3 then rates against
 * its own excerpt 0, so that one pair leaks. The second vibe has no ratings.
 * @param {{ ratings?: boolean }} [options] false seeds only thumbs, as the owner's store holds
 */
async function setup({ ratings = true } = {}) {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const { store } = app;
  /** @param {string} name */
  const brief = (name) => createVibe(store, { name, brief: "b", constraints: {}, softTargets: {} });
  const vibe = brief("still water");
  const empty = brief("night bus");
  let made_genomes = 0;

  /** @param {Measures} measures */
  const excerpt = ({ taste, range, loudest, gain }) => {
    made_genomes += 1;
    const genome = putGenome(store, vibe.id, {
      ...droneGenome,
      macros: { ...droneGenome.macros, brightness: made_genomes / 100 },
    });
    const heard = { ...heardExcerpt(genome.id), engineVersion: ENGINE_VERSION };
    const audio = addRatedAudio(store, {
      ...heard,
      target: TARGET,
      file: `${genome.id}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: gain,
    });
    const { engineVersion: _, ...window } = heard;
    putRender(store, {
      ...window,
      target: TARGET,
      producer: PRODUCER,
      file: `${genome.id}.wav`,
      features: {
        raw: { loudness: TARGET - gain, shortTermMax: loudest, loudnessRange: range, truePeak: -2 },
        heard: {
          gainDb: gain,
          centroidMean: taste,
          centroidSpread: 200,
          onsetRate: 0.5,
          lowEndShare: 0.3,
          stereoWidth: 0.4,
          flatness: 0.1,
        },
      },
      checks: {},
    });
    putEmbedding(store, {
      ratedAudioId: audio.id,
      renderId: null,
      producer: EMBEDDER.producer,
      vector: new Uint8Array(new Float32Array([1, 0, 0, taste]).buffer),
    });
    return {
      ...heard,
      ratedAudioId: audio.id,
      playedFraction: 1,
      measures: { taste, range, loudest, gain },
    };
  };

  const sessions = SESSIONS.map(() => startSession(store, vibe.id));
  /** @type {{ winnerLeft: boolean, winner: Measures, loser: Measures, session: number }[]} */
  const decided = [];
  let count = 0;
  /**
   * @param {number} session index into `sessions`
   * @param {ReturnType<typeof excerpt>} winner
   * @param {ReturnType<typeof excerpt>} loser
   * @param {"a" | "tie"} outcome
   */
  const rate = (session, winner, loser, outcome = "a") => {
    const leftSide = count++ % 2 === 0 ? "a" : "b";
    const { measures: _w, ...a } = winner;
    const { measures: _l, ...b } = loser;
    return addRating(store, {
      sessionId: /** @type {{ id: number }} */ (sessions[session]).id,
      vibeRevisionId: vibe.revision.id,
      a: { ...a, ...unranked },
      b: { ...b, ...unranked },
      leftSide,
      orderSeed: 1,
      outcome,
      timeTakenMs: 1,
    });
  };
  /** @param {number} session @param {ReturnType<typeof excerpt>} heard */
  const thumbs = (session, heard) => {
    const { measures: _, ...rest } = heard;
    return addFeedback(store, {
      sessionId: /** @type {{ id: number }} */ (sessions[session]).id,
      vibeRevisionId: vibe.revision.id,
      ...rest,
      timeTakenMs: 1,
      kind: "thumbs",
      direction: "up",
      note: null,
      macro: null,
      macroValue: null,
    });
  };

  const own = SESSIONS.map(() => MEASURES.map(excerpt));
  const extra = excerpt({ taste: 9, range: 1, loudest: -12, gain: 0 });
  if (!ratings) {
    for (const [session, excerpts] of own.entries())
      thumbs(session, /** @type {any} */ (excerpts[0]));
    return { ...made, vibe, empty, sessions, decided };
  }
  for (const [session, { decided: list }] of SESSIONS.entries()) {
    const excerpts = /** @type {ReturnType<typeof excerpt>[]} */ (own[session]);
    for (const [w, l] of list) {
      const winner = /** @type {ReturnType<typeof excerpt>} */ (
        excerpts[/** @type {number} */ (w)]
      );
      const loser = /** @type {ReturnType<typeof excerpt>} */ (excerpts[/** @type {number} */ (l)]);
      decided.push({
        winnerLeft: count % 2 === 0,
        winner: winner.measures,
        loser: loser.measures,
        session,
      });
      rate(session, winner, loser);
    }
  }
  const second = /** @type {ReturnType<typeof excerpt>[]} */ (own[1]);
  const third = /** @type {ReturnType<typeof excerpt>[]} */ (own[2]);
  const tie = rate(1, /** @type {any} */ (second[0]), /** @type {any} */ (second[1]), "tie");
  thumbs(1, extra);
  const leaked = rate(2, extra, /** @type {any} */ (third[0]));
  return { ...made, vibe, empty, sessions, decided, tie, leaked };
}

const job = () => ({ signal: new AbortController().signal, progress: () => undefined });
const fitted = { do: /** @type {const} */ ("answer"), result: FITTED, floats: [] };
const start = [
  { do: /** @type {const} */ ("answer"), result: EMBEDDER },
  { do: /** @type {const} */ ("answer"), result: CODE },
];
const predicted = (/** @type {{ feature: number, variance: number }} */ scores) => ({
  do: /** @type {const} */ ("answer"),
  result: { count: 0 },
  scores,
});
/** Per fold: the full model's two fits and predict, then the features-only model's. */
const fold = (model = MODEL_SCORES) => [
  fitted,
  fitted,
  predicted(model),
  fitted,
  fitted,
  predicted(FEATURES_SCORES),
];

/**
 * Each session's tally for a baseline, counted from the ratings as seeded.
 * @param {{ winnerLeft: boolean, winner: Measures, loser: Measures, session: number }[]} decided
 * @param {(pair: (typeof decided)[number]) => number} call
 */
const tallies = (decided, call) =>
  SESSIONS.map((_, session) => {
    const own = decided.filter((pair) => pair.session === session);
    return {
      session,
      agreed: own.reduce((sum, pair) => sum + call(pair), 0),
      scored: own.length,
    };
  });

/** @param {ReturnType<typeof tallies>} found @param {number[]} ids */
const withIds = (found, ids) =>
  found.map(({ session, agreed, scored }) => ({
    sessionId: /** @type {number} */ (ids[session]),
    agreed,
    scored,
  }));

test("agreement and its interval match a hand count, beside each baseline", async () => {
  const { app, sidecar, vibe, empty, sessions, decided } = await setup();
  sidecar.script(...start, ...fold(), ...fold(), ...fold());
  /** @type {[number, number, string | null][]} */
  const reports = [];
  await preferenceTestJob(app)({
    signal: new AbortController().signal,
    progress: (done, total, step) => reports.push([done, total, step]),
  });
  const report = /** @type {any} */ (await readPreferenceTest(app.paths));
  const ids = sessions.map((s) => s.id);
  const [tested, untested] = report.vibes;
  expect(tested).toMatchObject({
    vibeId: vibe.id,
    pairs: 43,
    ties: 1,
    sessions: 3,
    shortfall: null,
  });
  expect(tested.test).toMatchObject({ scored: 41, ties: 1, leaked: 1 });

  // By hand: 12 + 10 + 7 of 14 + 13 + 14.
  const model = [
    { sessionId: ids[0], agreed: 12, scored: 14 },
    { sessionId: ids[1], agreed: 10, scored: 13 },
    { sessionId: ids[2], agreed: 7, scored: 14 },
  ];
  expect(tested.test.model).toEqual({
    agreement: agreement(/** @type {any} */ (model)),
    unscored: 0,
  });
  expect(tested.test.model.agreement).toMatchObject({ agreed: 29, scored: 41 });
  const louder = withIds(
    tallies(decided, ({ winner, loser }) =>
      credit(winner.loudest + winner.gain, loser.loudest + loser.gain),
    ),
    ids,
  );
  expect(tested.test.louder.agreement).toEqual(agreement(louder));
  const featuresOnly = withIds(
    tallies(decided, ({ winner, loser }) => credit(winner.range, loser.range)),
    ids,
  );
  expect(tested.test.featuresOnly.agreement).toEqual(agreement(featuresOnly));
  expect(tested.test.featuresOnly.agreement.agreed).toBe(12);
  expect(reports.at(-1)).toEqual([3, 3, null]);

  expect(untested).toMatchObject({
    vibeId: empty.id,
    pairs: 0,
    shortfall: { pairs: 40, sessions: 3 },
    test: null,
  });
});

test("always-left scores the share of left wins", async () => {
  const { app, sidecar, decided, sessions } = await setup();
  sidecar.script(...start, ...fold(), ...fold(), ...fold());
  await preferenceTestJob(app)(job());
  const report = /** @type {any} */ (await readPreferenceTest(app.paths));
  const left = decided.filter((pair) => pair.winnerLeft).length;
  const found = report.vibes[0].test.alwaysLeft.agreement;
  expect(found).toMatchObject({ agreed: left, scored: 41 });
  expect(found).toEqual(
    agreement(
      withIds(
        tallies(decided, ({ winnerLeft }) => (winnerLeft ? 1 : 0)),
        sessions.map((s) => s.id),
      ),
    ),
  );
});

test("ties are left out of agreement and counted", async () => {
  const { app, sidecar, sessions } = await setup();
  sidecar.script(...start, ...fold(), ...fold(), ...fold());
  await preferenceTestJob(app)(job());
  const report = /** @type {any} */ (await readPreferenceTest(app.paths));
  const second = report.vibes[0].test.folds[1];
  expect(second).toEqual({ sessionId: sessions[1]?.id, scored: 13, ties: 1, leaked: 0 });
});

test("a pair sharing a genome with training is held back and counted as leaked", async () => {
  const { app, sidecar, sessions } = await setup();
  sidecar.script(...start, ...fold(), ...fold(), ...fold());
  await preferenceTestJob(app)(job());
  const report = /** @type {any} */ (await readPreferenceTest(app.paths));
  expect(report.vibes[0].test.folds[2]).toEqual({
    sessionId: sessions[2]?.id,
    scored: 14,
    ties: 0,
    leaked: 1,
  });
});

test("each fold is fitted with its session held out, the baseline with no CLAP terms", async () => {
  const { app, sidecar, vibe, sessions } = await setup();
  sidecar.script(...start, ...fold(), ...fold(), ...fold());
  await preferenceTestJob(app)(job());
  const featuresOnly = { ...HYPERPARAMETERS, pcaDimension: 0 };
  for (const { id } of sessions) {
    for (const hyperparameters of [HYPERPARAMETERS, featuresOnly]) {
      const plan = modelPlan(app.store, EMBEDDER.producer, {
        modelCode: CODE.code,
        heldOutSession: id,
        hyperparameters,
      });
      const own = plan.vibes.find((v) => v.vibeId === vibe.id);
      expect(existsSync(modelFile(app.paths, /** @type {string} */ (own?.key)))).toBe(true);
      expect(existsSync(modelFile(app.paths, /** @type {string} */ (own?.prior.key)))).toBe(true);
    }
  }
  // Nothing fitted on every session.
  const whole = modelPlan(app.store, EMBEDDER.producer, { modelCode: CODE.code });
  expect(existsSync(modelFile(app.paths, /** @type {string} */ (whole.vibes[0]?.key)))).toBe(false);
});

test("a model whose every score has no variance reads no model yet, never scored", async () => {
  const { app, sidecar } = await setup();
  const none = { ...MODEL_SCORES, variance: 0 };
  sidecar.script(...start, ...fold(none), ...fold(none), ...fold(none));
  await preferenceTestJob(app)(job());
  const report = /** @type {any} */ (await readPreferenceTest(app.paths));
  expect(report.vibes[0].test.model).toEqual({ agreement: null, unscored: 41 });
  expect(report.vibes[0].test.featuresOnly.unscored).toBe(0);
});

test("with thumbs alone every vibe reads not enough data, and the sidecar is never asked", async () => {
  const { app, sidecar, vibe, empty } = await setup({ ratings: false });
  await preferenceTestJob(app)(job());
  expect(await sidecar.received()).toEqual([]);
  const report = /** @type {any} */ (await readPreferenceTest(app.paths));
  expect(report.embeddingProducer).toBeNull();
  expect(report.vibes).toEqual([
    expect.objectContaining({
      vibeId: vibe.id,
      pairs: 0,
      thumbs: 3,
      shortfall: { pairs: 40, sessions: 3 },
      test: null,
    }),
    expect.objectContaining({
      vibeId: empty.id,
      pairs: 0,
      thumbs: 0,
      shortfall: { pairs: 40, sessions: 3 },
      test: null,
    }),
  ]);
});

test("a cancel stops the test and keeps the last report", async () => {
  const { app, sidecar } = await setup();
  sidecar.script(...start, fitted, { do: "hang" });
  const controller = new AbortController();
  const running = preferenceTestJob(app)({ signal: controller.signal, progress: () => undefined });
  await sidecar.waitForReceived(4);
  controller.abort();
  await expect(running).rejects.toThrow("cancelled");
  expect(await readPreferenceTest(app.paths)).toBeNull();
});

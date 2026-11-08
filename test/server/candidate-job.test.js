// The session's candidate job run directly with a signal the test controls (decision 0027), and
// the excerpt it renders for each candidate as it is made (0031). No test reaches the real omlx.
/** @import { JobContext } from "../../src/server/job-runner.js" */
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { Render } from "../../src/server/render-store.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ATTACHMENT_KIND } from "../../src/domain/attachment-kind.js";
import { featuresText } from "../../src/domain/features-text.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { referencesText } from "../../src/domain/references-text.js";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import { addAttachment } from "../../src/server/attachment-store.js";
import { currentExcerpt } from "../../src/server/candidate-excerpt.js";
import { candidateJob, STREAM_SEEDS } from "../../src/server/candidate-job.js";
import { candidatePairs } from "../../src/server/candidate-pair.js";
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { findEmbedding, putEmbedding } from "../../src/server/embedding-store.js";
import {
  mutationSeed,
  requestGroupName,
  revisedGroupName,
  revisionSeed,
} from "../../src/server/generate-candidates.js";
import {
  addCandidate,
  getCandidate,
  getGeneration,
  getGenome,
  listSessionCandidates,
  putGenome,
} from "../../src/server/generation-store.js";
import { setLock } from "../../src/server/lock-store.js";
import { modelFile, modelPlan } from "../../src/server/preference-model.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addFeedback, addRatedAudio } from "../../src/server/rating-store.js";
import { addReferenceFile, addRegion } from "../../src/server/reference-store.js";
import {
  findRegionAnalysis,
  putRegionEmbedding,
  putRegionFeatures,
} from "../../src/server/region-analysis-store.js";
import { getRender } from "../../src/server/render-store.js";
import { RETRIEVAL_METHOD } from "../../src/server/retrieve-examples.js";
import { readRanking } from "../../src/server/session-ranking.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { driveGaps } from "../support/fake-clock.js";
import { GENOMES, VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

test("a cancel that lands before the job listens for it, as during indexing, sends nothing", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  const vibe = createVibe(app.store, VIBE);
  const session = startSession(app.store, vibe.id);
  const run = candidateJob(app, { vibeId: vibe.id, sessionId: session.id, count: 2 });
  const signal = AbortSignal.abort(new Error("job 1 was cancelled"));

  await expect(run({ signal, progress: () => undefined })).rejects.toThrow(/cancelled/);
  expect(omlx.requests).toHaveLength(0);
});

/**
 * An answer as the model gives it, sent by the fake omlx as one token.
 * @param {unknown} genome
 */
const answer = (genome) => ({ tokens: [JSON.stringify({ intent: "a slow cold drone", genome })] });

/** @typedef {{ done: number, total: number, step: string | null, requests: number }} Report */

/**
 * A test app with a session on `vibe`, and a job context that records each progress report
 * with how many requests omlx had received by then. `onReport` sees each one as it is made.
 * @param {(report: Report, controller: AbortController) => void} [onReport]
 * @param {typeof VIBE} [draft] the vibe, `VIBE` when omitted
 */
async function sessionApp(onReport, draft = VIBE) {
  const made = await testApp();
  apps.push(made);
  const { app, omlx, clock, sidecar } = made;
  const vibe = createVibe(app.store, draft);
  const session = startSession(app.store, vibe.id);
  /** @type {Report[]} */
  const reports = [];
  const controller = new AbortController();
  /** @type {JobContext} */
  const job = {
    signal: controller.signal,
    progress: (done, total, step) => {
      const report = { done, total, step, requests: omlx.requests.length };
      reports.push(report);
      onReport?.(report, controller);
    },
  };
  /**
   * @param {number} count
   * @param {Parameters<typeof candidateJob>[1]["explore"]} [explore]
   * @param {Parameters<typeof candidateJob>[1]["breed"]} [breed]
   */
  const run = (count, explore, breed) =>
    driveGaps(
      clock,
      app.config.queue.minGapMs,
      candidateJob(app, { vibeId: vibe.id, sessionId: session.id, count, explore, breed })(job),
    );
  return { app, omlx, sidecar, vibe, session, reports, run };
}

test("renders each valid candidate before asking for the next, and says each step", async () => {
  const { app, omlx, session, reports, run } = await sessionApp();
  const [drone, variant] = GENOMES;
  // The second's first answer is quieter than the vibe's -16 LUFS, so it is repaired.
  omlx.script(answer(drone), answer({ ...variant, loudness: -20 }), answer(variant));

  const result = await run(2);
  expect(reports).toEqual([
    { done: 0, total: 2, step: "Asking the model for candidate 1 of 2", requests: 0 },
    { done: 0, total: 2, step: "Rendering the excerpt for candidate 1 of 2", requests: 1 },
    { done: 0, total: 2, step: "Measuring candidate 1 of 2", requests: 1 },
    { done: 1, total: 2, step: null, requests: 1 },
    { done: 1, total: 2, step: "Asking the model for candidate 2 of 2", requests: 1 },
    { done: 1, total: 2, step: "Asking the model to fix candidate 2", requests: 2 },
    { done: 1, total: 2, step: "Rendering the excerpt for candidate 2 of 2", requests: 3 },
    { done: 1, total: 2, step: "Measuring candidate 2 of 2", requests: 3 },
    { done: 2, total: 2, step: null, requests: 3 },
  ]);
  const candidates = listSessionCandidates(app.store, session.id);
  expect(result.candidateIds).toEqual(candidates.map(({ id }) => id));
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual(result.candidateIds);
  for (const { renderId } of result.excerpts) expect(getRender(app.store, renderId)).toBeDefined();
});

test("a rejected candidate is counted without a render", async () => {
  const { omlx, reports, run } = await sessionApp();
  omlx.script({ tokens: ["no genome here"] });
  const result = await run(1);
  expect(result.excerpts).toEqual([]);
  expect(reports.map(({ done, step }) => [done, step])).toEqual([
    [0, "Asking the model for candidate 1 of 1"],
    [1, null],
  ]);
});

test("a cancel during a render stops the job before its next request", async () => {
  const { omlx, run } = await sessionApp(({ step }, controller) => {
    if (step?.startsWith("Rendering")) controller.abort(new Error("job 1 was cancelled"));
  });
  const [drone, variant] = GENOMES;
  omlx.script(answer(drone), answer(variant));
  await expect(run(2)).rejects.toThrow(/cancelled/);
  expect(omlx.requests).toHaveLength(1);
});

// The revision pass (decision 0036). The drone's excerpt measures a low-end share near 0.82, so
// a vibe asking for at most 0.5 sends it back once; one asking for 0 to 1 doesn't.
const MISSED = { ...VIBE, softTargets: { features: { lowEndShare: [null, 0.5] } } };
const INSIDE = { ...VIBE, softTargets: { features: { lowEndShare: [0, 1] } } };
const MISS = "low-end share is";
/** The drone with one value changed that no test locks. */
const REVISED = { ...GENOMES[0], delayLevel: -30 };
/** The job's stream seed under the test app's `random`. */
const STREAM_SEED = Math.floor(0.25 * STREAM_SEEDS);

test("a candidate inside every range gets no revision", async () => {
  const { app, omlx, session, reports, run } = await sessionApp(undefined, INSIDE);
  omlx.script(answer(GENOMES[0]));
  const result = await run(1);
  expect(omlx.requests).toHaveLength(1);
  expect(listSessionCandidates(app.store, session.id)).toHaveLength(1);
  expect(result.excerpts).toHaveLength(1);
  expect(reports.map(({ step }) => step)).toContain("Measuring candidate 1 of 1");
  expect(result.notEmbedded).toBe(NO_CHECKPOINT_CACHE);
});

// Embedding each excerpt (decision 0042), against the fake sidecar.
const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 2 };

/** @param {TestApp["app"]} app */
function setCheckpointCache(app) {
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  return checkpointCache;
}

test("with the sidecar set up, each excerpt is embedded after its features", async () => {
  const { app, omlx, sidecar, reports, run } = await sessionApp(undefined, INSIDE);
  const checkpointCache = setCheckpointCache(app);
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "answer", result: { windows: 3 }, floats: [0.6, 0.8] },
  );
  const result = await run(1);
  expect(result.notEmbedded).toBeNull();
  expect(result.excerpts).toHaveLength(1);
  const { renderId } = /** @type {{ renderId: number }} */ (result.excerpts[0]);
  const render = /** @type {Render} */ (getRender(app.store, renderId));
  const requests = (await sidecar.received()).map(({ request }) => request);
  expect(requests).toMatchObject([
    { method: "embedder", params: { checkpointCache, fetch: false } },
    { method: "embed_audio", params: { audio: join(app.paths.renderCache, render.file) } },
  ]);
  const source = { ratedAudioId: null, renderId };
  const row = findEmbedding(app.store, source, EMBEDDER.producer);
  expect(row?.vector).toEqual(new Uint8Array(new Float32Array([0.6, 0.8]).buffer));
  expect(reports.map(({ step }) => step).filter(Boolean)).toEqual([
    "Asking the model for candidate 1 of 1",
    "Rendering the excerpt for candidate 1 of 1",
    "Analyzing the sound of candidate 1 of 1",
    "Measuring candidate 1 of 1",
  ]);
});

test("an excerpt that already has an embedding isn't embedded again", async () => {
  const { app, omlx, sidecar, run } = await sessionApp(undefined, INSIDE);
  setCheckpointCache(app);
  omlx.script(answer(GENOMES[0]), answer(GENOMES[0]));
  const ready = { do: /** @type {const} */ ("answer"), result: { ...EMBEDDER, ready: true } };
  sidecar.script(ready, { do: "answer", result: { windows: 3 }, floats: [0.6, 0.8] }, ready);
  const first = await run(1);
  // An explore from the first, under the same stream seed, draws the same candidate seed in
  // its own request group; answered with the same genome, it is the cached excerpt, which has
  // its row.
  const base = /** @type {Candidate} */ (getCandidate(app.store, first.candidateIds[0] ?? 0));
  const second = await run(1, { base, genome: genomeOf(app, base), direction: null });
  expect(second.excerpts.map(({ renderId }) => renderId)).toEqual(
    first.excerpts.map(({ renderId }) => renderId),
  );
  expect((await sidecar.received()).map(({ request }) => request.method)).toEqual([
    "embedder",
    "embed_audio",
    "embedder",
  ]);
});

test("a sidecar failure while embedding fails the job, naming the file", async () => {
  const { app, omlx, sidecar, run } = await sessionApp(undefined, INSIDE);
  setCheckpointCache(app);
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "crash", stderr: "MemoryError\n", code: 3 },
  );
  await expect(run(1)).rejects.toThrow(
    /^embedding .*\.(wav|mp3) failed: sidecar request embed_audio failed: the sidecar exited with code 3: MemoryError$/,
  );
});

test("with the checkpoint not downloaded, the job skips embedding and says why", async () => {
  const { app, omlx, sidecar, run } = await sessionApp(undefined, INSIDE);
  const checkpointCache = setCheckpointCache(app);
  omlx.script(answer(GENOMES[0]));
  sidecar.script({ do: "answer", result: { ...EMBEDDER, ready: false } });
  const result = await run(1);
  expect(result.excerpts).toHaveLength(1);
  expect(result.notEmbedded).toBe(
    `the CLAP checkpoint isn't in ${checkpointCache} yet, so excerpts aren't embedded; start the embed job to download it`,
  );
  expect((await sidecar.received()).map(({ request }) => request.method)).toEqual(["embedder"]);
});

// Ranking by the taste model (decision 0046): only with a model file under the brief's key.

/** Writes a model file under the only vibe's current key; the fake never reads it. */
async function writeModel(/** @type {TestApp["app"]} */ app) {
  const plan = modelPlan(app.store, EMBEDDER.producer, { modelCode: "preference-aa" });
  await mkdir(app.paths.models, { recursive: true });
  await writeFile(modelFile(app.paths, /** @type {any} */ (plan.vibes[0]).key), "{}");
}

const RANK_LOOKUP = [
  { do: /** @type {const} */ ("answer"), result: { ...EMBEDDER, ready: true } },
  { do: /** @type {const} */ ("answer"), result: { code: "preference-aa" } },
];

test("with no model file, the job ranks nothing and says nothing of it", async () => {
  const { app, omlx, sidecar, run } = await sessionApp(undefined, INSIDE);
  setCheckpointCache(app);
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "answer", result: { windows: 3 }, floats: [0.6, 0.8] },
  );
  const result = await run(1);
  expect(result).toMatchObject({ ranked: 0, notRanked: null });
  expect((await sidecar.received()).map(({ request }) => request.method)).toEqual([
    "embedder",
    "embed_audio",
  ]);
});

test("with a current model, the job ranks the session once its candidates are made", async () => {
  const { app, omlx, sidecar, session, reports, run } = await sessionApp(undefined, INSIDE);
  setCheckpointCache(app);
  await writeModel(app);
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "answer", result: { windows: 3 }, floats: [0.6, 0.8] },
    ...RANK_LOOKUP,
    { do: "answer", result: { count: 1 }, scores: { feature: 0, variance: 1 } },
  );
  const result = await run(1);
  expect(result).toMatchObject({ ranked: 1, notRanked: null });
  expect(reports.at(-1)).toMatchObject({ done: 1, step: "Ranking the candidates by your taste" });
  const ranking = await readRanking(app.paths, session.id);
  expect(ranking?.excerpts.map(({ renderId }) => renderId)).toEqual(
    result.excerpts.map(({ renderId }) => renderId),
  );
  expect((await sidecar.received()).map(({ request }) => request.method)).toEqual([
    "embedder",
    "embed_audio",
    "embedder",
    "preference_code",
    "predict",
  ]);
});

test("a sidecar failure while ranking fails the job loudly", async () => {
  const { app, omlx, sidecar, run } = await sessionApp(undefined, INSIDE);
  setCheckpointCache(app);
  await writeModel(app);
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "answer", result: { windows: 3 }, floats: [0.6, 0.8] },
    ...RANK_LOOKUP,
    { do: "error", error: "the items don't match the model" },
  );
  await expect(run(1)).rejects.toThrow(
    /^ranking the candidates failed: .*the items don't match the model$/,
  );
});

// Examples by similarity to the brief (decision 0024's 4h amendment).
/**
 * Rates GENOMES[1] thumbs up in the session's vibe, with its rated audio embedded under the
 * fake embedder's producer.
 * @param {TestApp["app"]} app
 * @param {{ id: number, revision: { id: number } }} vibe
 * @param {{ id: number }} session
 */
function likedAndEmbedded(app, vibe, session) {
  const genome = putGenome(app.store, vibe.id, GENOMES[1]);
  const heard = { genomeId: genome.id, seed: 7, offset: 12.5, duration: 25, engineVersion: 2 };
  const audio = addRatedAudio(app.store, {
    ...heard,
    target: -16,
    file: `${genome.id}.flac`,
    pcmSha256: "0".repeat(64),
    gainDb: 0,
  });
  addFeedback(app.store, {
    ...heard,
    sessionId: session.id,
    vibeRevisionId: vibe.revision.id,
    ratedAudioId: audio.id,
    playedFraction: 1,
    timeTakenMs: 1,
    kind: "thumbs",
    direction: "up",
    note: null,
    macro: null,
    macroValue: null,
  });
  const vector = new Uint8Array(new Float32Array([0.6, 0.8]).buffer);
  putEmbedding(app.store, {
    ratedAudioId: audio.id,
    renderId: null,
    producer: EMBEDDER.producer,
    vector,
  });
  return genome;
}

test("with rated audio embedded, the job embeds the brief once and logs clap-similarity", async () => {
  const { app, omlx, sidecar, vibe, session, run } = await sessionApp(undefined, INSIDE);
  const checkpointCache = setCheckpointCache(app);
  const liked = likedAndEmbedded(app, vibe, session);
  omlx.script(answer(GENOMES[0]), answer(GENOMES[0]));
  const ready = { do: /** @type {const} */ ("answer"), result: { ...EMBEDDER, ready: true } };
  sidecar.script(
    ready,
    { do: "answer", result: {}, floats: [1, 0] },
    { do: "answer", result: { windows: 3 }, floats: [0.6, 0.8] },
    ready,
  );
  const first = await run(1);
  expect(first.retrievalMethod).toBe(RETRIEVAL_METHOD.clapSimilarity);
  const base = /** @type {Candidate} */ (getCandidate(app.store, first.candidateIds[0] ?? 0));
  expect(getGeneration(app.store, /** @type {number} */ (base.generationId))).toMatchObject({
    retrievalMethod: RETRIEVAL_METHOD.clapSimilarity,
    exampleIds: [liked.id],
  });

  // The explore's prompt reads the brief's embedding from the cache, not the sidecar.
  const second = await run(1, { base, genome: genomeOf(app, base), direction: null });
  expect(second.retrievalMethod).toBe(RETRIEVAL_METHOD.clapSimilarity);
  const requests = (await sidecar.received()).map(({ request }) => request);
  expect(requests.map(({ method }) => method)).toEqual([
    "embedder",
    "embed_text",
    "embed_audio",
    "embedder",
  ]);
  expect(requests[1]).toMatchObject({ params: { checkpointCache, text: INSIDE.brief } });
});

test("with no checkpoint, the job logs rating-recency though rated audio is embedded", async () => {
  const { app, omlx, sidecar, vibe, session, run } = await sessionApp(undefined, INSIDE);
  likedAndEmbedded(app, vibe, session);
  omlx.script(answer(GENOMES[0]));
  const result = await run(1);
  expect(result.retrievalMethod).toBe(RETRIEVAL_METHOD.ratingRecency);
  expect(result.notEmbedded).toBe(NO_CHECKPOINT_CACHE);
  expect(await sidecar.received()).toEqual([]);
});

test("a sidecar failure while embedding the brief fails the job before asking omlx", async () => {
  const { app, omlx, sidecar, vibe, session, run } = await sessionApp(undefined, INSIDE);
  setCheckpointCache(app);
  likedAndEmbedded(app, vibe, session);
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "crash", stderr: "MemoryError\n", code: 3 },
  );
  await expect(run(1)).rejects.toThrow(
    /^embedding the vibe's brief failed: sidecar request embed_text failed: the sidecar exited with code 3: MemoryError$/,
  );
  expect(omlx.requests).toHaveLength(0);
});

test("one outside a range is revised once, replaying its round-0 prompt with the measurements and the locks in force", async () => {
  const { app, omlx, vibe, session, reports, run } = await sessionApp(({ step }) => {
    // A lock taken after the first prompt went out: the ask restates the locks in force now.
    if (step === "Measuring candidate 1 of 1") {
      const [first] = listSessionCandidates(app.store, session.id);
      setLock(app.store, {
        vibeId: vibe.id,
        candidateId: /** @type {any} */ (first).id,
        path: "reverbLevel",
        value: -12,
        voiceType: null,
      });
    }
  }, MISSED);
  // The first try is repaired (too quiet), then revised.
  omlx.script(answer({ ...GENOMES[0], loudness: -20 }), answer(GENOMES[0]), answer(REVISED));

  const result = await run(1);
  expect(omlx.requests).toHaveLength(3);
  const [round0, repair, revision] = /** @type {[any, any, any]} */ (
    omlx.requests.map((r) => r.body)
  );
  const [first, revised] = listSessionCandidates(app.store, session.id);
  if (!first || !revised) throw new Error("expected a first try and its revision");

  // The earlier turns are the round-0 request's, byte for byte, never the repair's.
  expect(revision.messages.slice(0, 2)).toEqual(round0.messages);
  expect(repair.messages.slice(0, 2)).toEqual(round0.messages);
  const firstGenome = getGenome(app.store, /** @type {number} */ (first.genomeId))?.genome;
  expect(revision.messages[2]).toEqual({
    role: "assistant",
    content: JSON.stringify({ intent: first.intent, genome: firstGenome }),
  });
  expect(revision.messages).toHaveLength(4);
  const ask = revision.messages[3].content;
  const firstRender = getRender(app.store, /** @type {any} */ (result.excerpts[0]).renderId);
  expect(ask).toContain(featuresText(/** @type {any} */ (firstRender).features));
  expect(ask).toContain(MISS);
  expect(ask).toContain("reverbLevel = -12");
  // The revision uses the first try's sampling.
  expect(revision.temperature).toBe(round0.temperature);
  expect(revision.seed).toBe(round0.seed);

  expect(revised).toMatchObject({
    parentIds: [first.id],
    operator: "revise",
    rejectReason: null,
    seed: revisionSeed(STREAM_SEED, 0),
    operatorParams: expect.objectContaining({ unchanged: false }),
  });
  expect(revised.seed).not.toBe(first.seed);
  const generation = getGeneration(app.store, /** @type {number} */ (revised.generationId));
  expect(generation?.requestGroup).toBe(revisedGroupName(requestGroupName(vibe.id, STREAM_SEED)));
  expect(result.candidateIds).toEqual([first.id, revised.id]);
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual([first.id, revised.id]);
  expect(reports.map(({ step }) => step)).toEqual([
    "Asking the model for candidate 1 of 1",
    "Asking the model to fix candidate 1",
    "Rendering the excerpt for candidate 1 of 1",
    "Measuring candidate 1 of 1",
    "Revising candidate 1 of 1",
    "Rendering the revision of candidate 1 of 1",
    null,
  ]);
});

test("an unchanged answer is stored on the first try's genome and seed, and not rendered", async () => {
  const { app, omlx, session, run } = await sessionApp(undefined, MISSED);
  omlx.script(answer(GENOMES[0]), answer(GENOMES[0]));
  const result = await run(1);
  const [first, revised] = listSessionCandidates(app.store, session.id);
  expect(revised).toMatchObject({
    operator: "revise",
    parentIds: [first?.id],
    genomeId: first?.genomeId,
    seed: first?.seed,
    operatorParams: { unchanged: true },
  });
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual([first?.id]);
});

test("a revision with errors gets one repair round, then is stored rejected", async () => {
  const { app, omlx, session, run } = await sessionApp(undefined, MISSED);
  const quiet = answer({ ...REVISED, loudness: -20 });
  omlx.script(answer(GENOMES[0]), quiet, quiet);
  const result = await run(1);
  expect(omlx.requests).toHaveLength(3);
  const [, revision, repair] = /** @type {[any, any, any]} */ (omlx.requests.map((r) => r.body));
  expect(repair.messages.slice(0, 4)).toEqual(revision.messages);
  const [first, revised] = listSessionCandidates(app.store, session.id);
  expect(revised).toMatchObject({
    operator: "revise",
    parentIds: [first?.id],
    rejectReason: "lintErrors",
    genomeId: null,
  });
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual([first?.id]);
});

test("a follow-up over the context budget isn't sent, and the skip is noted", async () => {
  const { app, omlx, session, run } = await sessionApp(({ step }) => {
    if (step !== "Measuring candidate 1 of 1") return;
    // Room for the first prompt and not much more, so the follow-up doesn't fit.
    const sent = estimateTokens(promptText(omlx.requests[0]?.body.messages));
    app.config = { ...app.config, queue: { ...app.config.queue, contextBudgetTokens: sent + 10 } };
  }, MISSED);
  omlx.script(answer(GENOMES[0]));
  const result = await run(1);
  expect(omlx.requests).toHaveLength(1);
  const [first] = listSessionCandidates(app.store, session.id);
  const skipped = getCandidate(app.store, /** @type {number} */ (result.candidateIds[1]));
  expect(skipped).toMatchObject({
    generationId: null,
    genomeId: first?.genomeId,
    seed: first?.seed,
    rejectReason: null,
    operator: "revise",
    parentIds: [first?.id],
    operatorParams: { unchanged: true },
    lint: { findings: [expect.objectContaining({ rule: "revisionOverBudget" })] },
  });
  expect(result.excerpts).toHaveLength(1);
  // The skip has no generation, so the session finds it by its own sessionId, and the
  // candidates route folds it like any unchanged revision.
  const listed = listSessionCandidates(app.store, session.id);
  expect(listed.map(({ id }) => id)).toEqual(result.candidateIds);
  const { pairs, folded } = candidatePairs(
    app.store,
    listed.map((candidate) => ({ candidate, excerpt: null })),
  );
  expect([...folded]).toEqual([skipped?.id]);
  expect(pairs.size).toBe(0);
});

test("a cancel between the render and the revision stops the job with every row stored", async () => {
  const { app, omlx, session, run } = await sessionApp(({ step }, controller) => {
    if (step?.startsWith("Measuring")) controller.abort(new Error("job 1 was cancelled"));
  }, MISSED);
  omlx.script(answer(GENOMES[0]), answer(REVISED));
  await expect(run(1)).rejects.toThrow(/cancelled/);
  expect(omlx.requests).toHaveLength(1);
  const [first, ...rest] = listSessionCandidates(app.store, session.id);
  expect(rest).toEqual([]);
  expect(
    currentExcerpt(app.store, app.paths.renderCache, /** @type {any} */ (first)),
  ).not.toBeNull();
});

test("a revision request that fails in the queue stops the job with its rows stored", async () => {
  const { app, omlx, session, run } = await sessionApp(undefined, MISSED);
  omlx.script(answer(GENOMES[0]), { status: 500, body: "boom" });
  await expect(run(1)).rejects.toThrow(/500/);
  expect(omlx.requests).toHaveLength(2);
  const [first, revised] = listSessionCandidates(app.store, session.id);
  expect(first).toMatchObject({ operator: null, rejectReason: null });
  expect(revised).toMatchObject({
    operator: "revise",
    parentIds: [first?.id],
    rejectReason: "requestFailed",
  });
  const generation = getGeneration(app.store, /** @type {number} */ (revised?.generationId));
  expect(generation).toMatchObject({
    finishReason: "error",
    error: expect.stringContaining("500"),
  });
});

test("a first try too quiet to normalize is revised, with its unmeasured features said", async () => {
  const { app, omlx, session, run } = await sessionApp(undefined, INSIDE);
  // Every voice starts after the excerpt's window, so the excerpt is silent.
  const silent = {
    ...GENOMES[0],
    voices: /** @type {any} */ (GENOMES[0]).voices.map((/** @type {any} */ v) => ({
      ...v,
      start: 55,
    })),
  };
  omlx.script(answer(silent), answer(GENOMES[0]));
  const result = await run(1);
  expect(omlx.requests).toHaveLength(2);
  const first = getRender(app.store, /** @type {any} */ (result.excerpts[0]).renderId);
  expect(first?.features).toMatchObject({ heard: null });
  const ask = omlx.requests[1]?.body.messages.at(-1).content;
  expect(ask).toContain("too quiet to normalize");
  expect(ask).toContain("low-end share couldn't be measured");
  expect(ask).toContain("(nearSilence)");
  const [, revised] = listSessionCandidates(app.store, session.id);
  expect(revised).toMatchObject({ operator: "revise", rejectReason: null });
});

// Explore (decision 0038): children of a base by fresh first prompts holding the base.

/**
 * The candidate's genome, from its row.
 * @param {TestApp["app"]} app
 * @param {{ genomeId: number | null }} candidate
 */
const genomeOf = (app, { genomeId }) =>
  /** @type {any} */ (getGenome(app.store, /** @type {number} */ (genomeId))?.genome);

/**
 * A base row stored directly, so a test renders nothing it doesn't check.
 * @param {TestApp["app"]} app
 * @param {{ id: number, revision: { id: number } }} vibe
 * @param {{ id: number }} session
 * @param {unknown} genome
 * @param {{ operator?: string | null, parentIds?: number[], source?: string }} [origin]
 */
const seedBase = (
  app,
  vibe,
  session,
  genome,
  { operator = null, parentIds = [], source = "llm" } = {},
) =>
  addCandidate(app.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: session.id,
    genomeId: putGenome(app.store, vibe.id, genome).id,
    seed: 5,
    source,
    parentIds,
    locks: [],
    operator,
    operatorParams: null,
    intent: "a slow cold drone",
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });

/** An answer with no genome: it is stored rejected, renders nothing and gets no repair. */
const NO_GENOME = { tokens: ["no genome here"] };

test("explore sends a fresh first prompt per child holding the base and the direction, and stores each child under the base", async () => {
  const { app, omlx, vibe, session, reports, run } = await sessionApp(undefined, INSIDE);
  const base = seedBase(app, vibe, session, GENOMES[0]);
  setLock(app.store, {
    vibeId: vibe.id,
    candidateId: base.id,
    path: "reverbDecay",
    value: 3,
    voiceType: null,
  });
  // The first child gives no genome, so only the second renders; it changes the locked value,
  // which goes back. A short reverb keeps that render quick.
  omlx.script(NO_GENOME, answer({ ...GENOMES[0], reverbDecay: 6, delayLevel: -28 }));

  const result = await run(2, { base, genome: genomeOf(app, base), direction: "slower" });
  expect(omlx.requests).toHaveLength(2);
  const locked = canonicalGenome({ ...genomeOf(app, base), reverbDecay: 3 });
  for (const { body } of omlx.requests) {
    expect(body.messages.map((/** @type {any} */ m) => m.role)).toEqual(["system", "user"]);
    const text = body.messages[1].content;
    expect(text).toContain(`The base genome to vary:\n${locked}`);
    expect(text).toContain('as a JSON string: "slower"');
    expect(text).toContain("reverbDecay = 3");
  }
  const children = listSessionCandidates(app.store, session.id).slice(1);
  expect(children.map(({ id }) => id)).toEqual(result.candidateIds);
  for (const child of children) {
    expect(child).toMatchObject({
      parentIds: [base.id],
      operator: "explore",
      sessionId: session.id,
      operatorParams: expect.objectContaining({ direction: "slower", baseTrimmed: false }),
    });
    expect(child.seed).not.toBe(base.seed);
    const generation = getGeneration(app.store, /** @type {number} */ (child.generationId));
    expect(generation?.requestGroup).toBe(requestGroupName(vibe.id, STREAM_SEED, "explore"));
  }
  const [rejected, kept] = children;
  expect(rejected?.seed).not.toBe(kept?.seed);
  expect(rejected).toMatchObject({ rejectReason: "noJson" });
  expect(kept).toMatchObject({
    rejectReason: null,
    operatorParams: expect.objectContaining({ locksChanged: ["reverbDecay"] }),
  });
  expect(genomeOf(app, /** @type {any} */ (kept)).reverbDecay).toBe(3);
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual([kept?.id]);
  expect(reports.map(({ step }) => step)).toContain("Asking the model for variation 2 of 2");
});

test("exploring from a revision or a nudge child sends a first prompt with no earlier turns", async () => {
  const { app, omlx, vibe, session, run } = await sessionApp(undefined, MISSED);
  const first = seedBase(app, vibe, session, GENOMES[0]);
  const revised = seedBase(app, vibe, session, REVISED, {
    operator: "revise",
    parentIds: [first.id],
  });
  const nudged = seedBase(
    app,
    vibe,
    session,
    { ...REVISED, delayLevel: -29 },
    {
      operator: "nudge",
      parentIds: [revised.id],
      source: "mutation",
    },
  );
  for (const [i, base] of [revised, nudged].entries()) {
    app.random = () => 0.5 + i / 10;
    const before = omlx.requests.length;
    omlx.script(NO_GENOME);
    await run(1, { base, genome: genomeOf(app, base), direction: null });
    const sent = /** @type {any} */ (omlx.requests[before]).body.messages;
    expect(sent.map((/** @type {any} */ m) => m.role)).toEqual(["system", "user"]);
    expect(sent[1].content).toContain(
      `The base genome to vary:\n${canonicalGenome(genomeOf(app, base))}`,
    );
    expect(sent[1].content).not.toContain("direction");
  }
});

test("an explore child that misses a range is revised, replaying its own explore prompt", async () => {
  const { app, omlx, vibe, session, run } = await sessionApp(undefined, MISSED);
  const base = seedBase(app, vibe, session, GENOMES[1]);
  // The revision's answer has no genome, so only the child renders.
  omlx.script(answer(GENOMES[0]), NO_GENOME);
  const result = await run(1, { base, genome: genomeOf(app, base), direction: "less bell" });
  expect(omlx.requests).toHaveLength(2);
  const [explore, revision] = /** @type {[any, any]} */ (omlx.requests.map((r) => r.body));
  expect(revision.messages.slice(0, 2)).toEqual(explore.messages);
  expect(revision.messages[1].content).toContain("The base genome to vary:");
  expect(revision.messages[3].content).toContain(MISS);
  const [, child, revised] = listSessionCandidates(app.store, session.id);
  expect(child).toMatchObject({ operator: "explore", parentIds: [base.id] });
  expect(revised).toMatchObject({ operator: "revise", parentIds: [child?.id] });
  expect(result.candidateIds).toEqual([child?.id, revised?.id]);
});

test("an explore whose base can't take the locks set after the route took it fails before asking", async () => {
  const { app, omlx, vibe, session, run } = await sessionApp();
  // The drone has no pad voice, so a lock on the pad's level can't go into it.
  const base = seedBase(app, vibe, session, GENOMES[0]);
  setLock(app.store, {
    vibeId: vibe.id,
    candidateId: base.id,
    path: "voices.pad.level",
    value: -12,
    voiceType: "pad",
  });
  await expect(run(1, { base, genome: genomeOf(app, base), direction: null })).rejects.toThrow(
    new RegExp(
      `^the base, candidate ${base.id}, can't take the vibe's locks: .*voices\\.pad\\.level`,
    ),
  );
  expect(omlx.requests).toHaveLength(0);
  expect(listSessionCandidates(app.store, session.id)).toEqual([base]);
});

// The regions attached to the vibe (decision 0052).
/**
 * Attaches a region to the vibe, analyzed at `target` with one window of `REGION_FEATURES`.
 * @param {TestApp["app"]} app
 * @param {number} vibeId
 * @param {number} target
 */
function attachRegion(app, vibeId, target) {
  const { reference } = addReferenceFile(app.store, {
    sha256: "f".repeat(64),
    fileName: "dawn.wav",
    format: "wav",
    file: `${"f".repeat(64)}.wav`,
    durationSeconds: 60,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  const region = addRegion(app.store, {
    referenceFileId: reference.id,
    startSeconds: 0,
    endSeconds: 10,
    label: "dawn hum",
    note: "under the birds",
  });
  const windows = [{ startSeconds: 0, seconds: 10, features: REGION_FEATURES, notHeard: null }];
  putRegionFeatures(app.store, { regionId: region.id, target, producer: PRODUCER, windows });
  const attachment = addAttachment(app.store, {
    vibeId,
    kind: ATTACHMENT_KIND.reference,
    regionId: region.id,
    details: {},
  });
  return { region, attachment };
}
const REGION_FEATURES = {
  raw: { loudness: -30, shortTermMax: -25, loudnessRange: 3, truePeak: -6 },
  heard: {
    gainDb: 14,
    centroidMean: 400,
    centroidSpread: 60,
    onsetRate: 0.1,
    lowEndShare: 0.6,
    stereoWidth: 0.05,
    flatness: 0.02,
  },
};

test("an attached region is in the first prompt and its revision, and each generation logs it", async () => {
  const { app, omlx, vibe, session, run } = await sessionApp(undefined, MISSED);
  const { attachment } = attachRegion(app, vibe.id, MISSED.constraints.loudness);
  omlx.script(answer(GENOMES[0]), answer(REVISED));
  await run(1);
  const [round0, revision] = /** @type {[any, any]} */ (omlx.requests.map((r) => r.body));
  const section = referencesText([
    {
      id: attachment.id,
      label: "dawn hum",
      note: "under the birds",
      windows: [REGION_FEATURES],
      words: [],
    },
  ]);
  expect(round0.messages[1].content).toContain(`\n\n${section}\n\n`);
  expect(revision.messages.slice(0, 2)).toEqual(round0.messages);
  const generations = listSessionCandidates(app.store, session.id).map((candidate) =>
    getGeneration(app.store, /** @type {number} */ (candidate.generationId)),
  );
  expect(generations.map((generation) => generation?.attachmentIds)).toEqual([
    [attachment.id],
    [attachment.id],
  ]);
});

test("an attached region not analyzed at the brief's loudness fails the job before asking omlx", async () => {
  const { app, omlx, vibe, run } = await sessionApp();
  const { region } = attachRegion(app, vibe.id, -23);
  omlx.script(answer(GENOMES[0]));
  await expect(run(1)).rejects.toThrow(`region ${region.id} ("dawn hum"), attached to this brief`);
  expect(omlx.requests).toHaveLength(0);
});

test("a vibe with nothing attached logs no attachments", async () => {
  const { app, omlx, session, run } = await sessionApp(undefined, INSIDE);
  omlx.script(answer(GENOMES[0]));
  await run(1);
  const [candidate] = listSessionCandidates(app.store, session.id);
  const generation = getGeneration(app.store, /** @type {number} */ (candidate?.generationId));
  expect(generation?.attachmentIds).toEqual([]);
});

test("a sidecar failure while embedding the vocabulary fails the job before asking omlx", async () => {
  const { app, omlx, sidecar, vibe, run } = await sessionApp();
  setCheckpointCache(app);
  const { region } = attachRegion(app, vibe.id, VIBE.constraints.loudness);
  const analysis = /** @type {any} */ (
    findRegionAnalysis(app.store, { regionId: region.id, target: -16, producer: PRODUCER })
  );
  putRegionEmbedding(app.store, analysis.id, {
    embeddingProducer: EMBEDDER.producer,
    embedding: new Uint8Array(new Float32Array([1, 0]).buffer),
  });
  omlx.script(answer(GENOMES[0]));
  sidecar.script(
    { do: "answer", result: { ...EMBEDDER, ready: true } },
    { do: "crash", stderr: "MemoryError\n", code: 3 },
  );
  await expect(run(1)).rejects.toThrow(
    /^embedding the word "dark" failed: sidecar request embed_text failed: the sidecar exited with code 3: MemoryError$/,
  );
  expect(omlx.requests).toHaveLength(0);
});

// Breeding (decision 0058): a crossover child of two parents by a fresh first prompt, then one
// small nudge of it.

/**
 * Two parents seeded as rows, the second with a longer reverb, as the route passes them.
 * @param {TestApp["app"]} app
 * @param {{ id: number, revision: { id: number } }} vibe
 * @param {{ id: number }} session
 */
function seedParents(app, vibe, session) {
  const a = seedBase(app, vibe, session, GENOMES[0]);
  const b = seedBase(app, vibe, session, GENOMES[1]);
  return {
    a,
    b,
    breed: {
      a: { base: a, genome: genomeOf(app, a), direction: null },
      b: { base: b, genome: genomeOf(app, b), direction: null },
      sketchIds: [21, 22],
    },
  };
}

test("breed sends each child a first prompt holding both parents with the live locks, stores it under both, and mutates it once", async () => {
  const { app, omlx, vibe, session, reports, run } = await sessionApp(undefined, INSIDE);
  const { a, b, breed } = seedParents(app, vibe, session);
  setLock(app.store, {
    vibeId: vibe.id,
    candidateId: a.id,
    path: "reverbDecay",
    value: 3,
    voiceType: null,
  });
  // The answer changes the locked value, which goes back.
  omlx.script(answer({ ...GENOMES[0], reverbDecay: 6, delayLevel: -28 }));

  const result = await run(1, undefined, breed);
  expect(omlx.requests).toHaveLength(1);
  const text = /** @type {any} */ (omlx.requests[0]).body.messages[1].content;
  expect(text).toContain(`Parent A:\n${canonicalGenome({ ...GENOMES[0], reverbDecay: 3 })}`);
  expect(text).toContain(`Parent B:\n${canonicalGenome({ ...GENOMES[1], reverbDecay: 3 })}`);
  expect(text).toContain("reverbDecay = 3");

  const [child, ...mutations] = listSessionCandidates(app.store, session.id).slice(2);
  expect(child).toMatchObject({
    parentIds: [a.id, b.id],
    operator: "breed",
    source: "breeding",
    rejectReason: null,
    operatorParams: expect.objectContaining({
      stage: "crossover",
      sketchIds: [21, 22],
      parentsTrimmed: [],
      locksChanged: ["reverbDecay"],
    }),
  });
  const generation = getGeneration(app.store, /** @type {number} */ (child?.generationId));
  expect(generation?.requestGroup).toBe(requestGroupName(vibe.id, STREAM_SEED, "breed"));

  const mutation = /** @type {Candidate} */ (mutations.at(-1));
  for (const draw of mutations) {
    expect(draw).toMatchObject({
      parentIds: [child?.id],
      operator: "breed",
      source: "breeding",
      seed: child?.seed,
      operatorParams: expect.objectContaining({
        stage: "mutation",
        stepSize: "small",
        seed: mutationSeed(STREAM_SEED, 0),
      }),
    });
  }
  expect(mutation.rejectReason).toBeNull();
  expect(genomeOf(app, mutation).reverbDecay).toBe(3);
  expect(genomeOf(app, mutation)).not.toEqual(genomeOf(app, /** @type {Candidate} */ (child)));
  expect(result.candidateIds).toEqual([child?.id, ...mutations.map(({ id }) => id)]);
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual([child?.id, mutation.id]);
  const steps = reports.map(({ step }) => step);
  expect(steps).toContain("Asking the model for child 1 of 1");
  expect(steps).toContain("Rendering the mutation of child 1 of 1");
});

test("a crossover child with no genome is stored under both parents and not mutated", async () => {
  const { app, omlx, vibe, session, run } = await sessionApp(undefined, INSIDE);
  const { a, b, breed } = seedParents(app, vibe, session);
  omlx.script(NO_GENOME);
  const result = await run(1, undefined, breed);
  const made = listSessionCandidates(app.store, session.id).slice(2);
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({ parentIds: [a.id, b.id], rejectReason: "noJson" });
  expect(result.excerpts).toEqual([]);
});

test("a breed whose parent B can't take the locks set after the route took it fails before asking", async () => {
  const { app, omlx, vibe, session, run } = await sessionApp();
  const { b, breed } = seedParents(app, vibe, session);
  // The drone has no pad voice, so a lock on the pad's level can't go into either parent.
  setLock(app.store, {
    vibeId: vibe.id,
    candidateId: b.id,
    path: "voices.pad.level",
    value: -12,
    voiceType: "pad",
  });
  await expect(run(1, undefined, breed)).rejects.toThrow(
    /^parent A, candidate \d+, can't take the vibe's locks: .*voices\.pad\.level/,
  );
  expect(omlx.requests).toHaveLength(0);
});

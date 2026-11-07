// The session's candidate job run directly with a signal the test controls (decision 0027), and
// the excerpt it renders for each candidate as it is made (0031). No test reaches the real omlx.
/** @import { JobContext } from "../../src/server/job-runner.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { featuresText } from "../../src/domain/features-text.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { currentExcerpt } from "../../src/server/candidate-excerpt.js";
import { candidateJob, STREAM_SEEDS } from "../../src/server/candidate-job.js";
import { candidatePairs } from "../../src/server/candidate-pair.js";
import {
  requestGroupName,
  revisedGroupName,
  revisionSeed,
} from "../../src/server/generate-candidates.js";
import {
  getCandidate,
  getGeneration,
  getGenome,
  listSessionCandidates,
} from "../../src/server/generation-store.js";
import { setLock } from "../../src/server/lock-store.js";
import { getRender } from "../../src/server/render-store.js";
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
  const { app, omlx, clock } = made;
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
  /** @param {number} count */
  const run = (count) =>
    driveGaps(
      clock,
      app.config.queue.minGapMs,
      candidateJob(app, { vibeId: vibe.id, sessionId: session.id, count })(job),
    );
  return { app, omlx, vibe, session, reports, run };
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

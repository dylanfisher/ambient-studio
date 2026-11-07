// The session's candidate job run directly with a signal the test controls (decision 0027), and
// the excerpt it renders for each candidate as it is made (0031). No test reaches the real omlx.
/** @import { JobContext } from "../../src/server/job-runner.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { candidateJob } from "../../src/server/candidate-job.js";
import { listSessionCandidates } from "../../src/server/generation-store.js";
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
 * A test app with a session on `VIBE`, and a job context that records each progress report
 * with how many requests omlx had received by then. `onReport` sees each one as it is made.
 * @param {(report: Report, controller: AbortController) => void} [onReport]
 */
async function sessionApp(onReport) {
  const made = await testApp();
  apps.push(made);
  const { app, omlx, clock } = made;
  const vibe = createVibe(app.store, VIBE);
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
  return { app, omlx, session, reports, run };
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
    { done: 1, total: 2, step: null, requests: 1 },
    { done: 1, total: 2, step: "Asking the model for candidate 2 of 2", requests: 1 },
    { done: 1, total: 2, step: "Asking the model to fix candidate 2", requests: 2 },
    { done: 1, total: 2, step: "Rendering the excerpt for candidate 2 of 2", requests: 3 },
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

// The nudge job run directly with a signal the test controls (decision 0037): children stored
// with their base, each rejected draw kept, each child's excerpt rendered, and no omlx request.
/** @import { JobContext } from "../../src/server/job-runner.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { NUDGE_DRAWS } from "../../src/domain/nudge.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import {
  addCandidate,
  getCandidate,
  listSessionCandidates,
  putGenome,
} from "../../src/server/generation-store.js";
import { nudgeJob } from "../../src/server/nudge-job.js";
import { getRender } from "../../src/server/render-store.js";
import { startSession, stopSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

/** @typedef {{ done: number, total: number, step: string | null }} Report */

/**
 * A test app with a vibe, a session on it and a base candidate made in that session, and a job
 * context that records each progress report.
 * @param {{ constraints?: Record<string, unknown>, genome?: Record<string, unknown> }} [options]
 */
async function nudgeApp({ constraints = VIBE.constraints, genome = droneGenome } = {}) {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  const vibe = createVibe(app.store, { ...VIBE, constraints });
  const session = startSession(app.store, vibe.id);
  const row = putGenome(app.store, vibe.id, genome);
  const base = addCandidate(app.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: session.id,
    genomeId: row.id,
    seed: 11,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: "a slow cold drone",
    rejectReason: null,
    lint: { ok: true, findings: [] },
    rejectedGenome: null,
  });
  /** @type {Report[]} */
  const reports = [];
  /** @type {JobContext} */
  const job = {
    signal: new AbortController().signal,
    progress: (done, total, step) => reports.push({ done, total, step }),
  };
  /**
   * @param {number} sessionId
   * @param {number} count
   */
  const run = (sessionId, count) =>
    nudgeJob(app, {
      vibeId: vibe.id,
      sessionId,
      base,
      genome: row.genome,
      stepSize: "small",
      count,
    })(job);
  return { app, omlx, vibe, session, base, reports, run };
}

test("a nudge stores its children with their base, renders each, and asks the model nothing", async () => {
  const { app, omlx, session, base, reports, run } = await nudgeApp();
  const result = await run(session.id, 2);

  const listed = listSessionCandidates(app.store, session.id);
  expect(listed.map(({ id }) => id)).toEqual([base.id, ...result.candidateIds]);
  const children = listed.filter(({ rejectReason, id }) => id !== base.id && !rejectReason);
  expect(children).toHaveLength(2);
  for (const child of children) {
    expect(child).toMatchObject({
      generationId: null,
      sessionId: session.id,
      seed: base.seed,
      source: "mutation",
      parentIds: [base.id],
      locks: [],
      operator: "nudge",
      operatorParams: { stepSize: "small", seed: result.seed },
      intent: null,
      lint: { ok: true },
      rejectedGenome: null,
    });
    expect(child.genomeId).not.toBe(base.genomeId);
  }
  expect(result.excerpts.map(({ candidateId }) => candidateId)).toEqual(
    children.map(({ id }) => id),
  );
  for (const { renderId } of result.excerpts) expect(getRender(app.store, renderId)).toBeDefined();
  expect(result.failedChildren).toEqual([]);
  expect(reports).toEqual([
    { done: 0, total: 2, step: "Rendering the excerpt for nudge 1 of 2" },
    { done: 1, total: 2, step: null },
    { done: 1, total: 2, step: "Rendering the excerpt for nudge 2 of 2" },
    { done: 2, total: 2, step: null },
  ]);
  expect(omlx.requests).toHaveLength(0);
});

test("a child whose draws all fail lint is reported, every draw kept rejected, nothing rendered", async () => {
  // Any move of the duration leaves the one value the vibe allows.
  const genome = { ...droneGenome, duration: 300 };
  const constraints = { ...VIBE.constraints, duration: { min: 300, max: 300 } };
  const { app, session, base, run } = await nudgeApp({ constraints, genome });
  const result = await run(session.id, 1);

  expect(result.failedChildren).toEqual([1]);
  expect(result.excerpts).toEqual([]);
  expect(result.candidateIds).toHaveLength(NUDGE_DRAWS);
  for (const id of result.candidateIds) {
    expect(getCandidate(app.store, id)).toMatchObject({
      genomeId: null,
      rejectReason: "lintErrors",
      parentIds: [base.id],
      operator: "nudge",
      rejectedGenome: { voices: droneGenome.voices.map(({ id }) => ({ id })) },
    });
  }
});

test("nudging from a candidate of an earlier session puts the children in the current one", async () => {
  const { app, vibe, session, base, run } = await nudgeApp();
  stopSession(app.store, session.id);
  const later = startSession(app.store, vibe.id);
  const result = await run(later.id, 1);

  expect(listSessionCandidates(app.store, later.id).map(({ id }) => id)).toEqual(
    result.candidateIds,
  );
  expect(listSessionCandidates(app.store, session.id).map(({ id }) => id)).toEqual([base.id]);
  const child = getCandidate(app.store, /** @type {number} */ (result.candidateIds.at(-1)));
  expect(child?.parentIds).toEqual([base.id]);
});

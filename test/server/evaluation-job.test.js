// The evaluation job run directly with a signal the test controls (decision 0030). No test
// reaches the real omlx.
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { evaluationJob } from "../../src/server/evaluation-job.js";
import { listEvaluations } from "../../src/server/evaluation-store.js";
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { locksInForce, setLock } from "../../src/server/lock-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { driveGaps } from "../support/fake-clock.js";
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
  const vibe = createVibe(app.store, /** @type {any} */ (SEED_VIBES["cold-dorian"]));
  const run = evaluationJob(app, { vibeIds: [vibe.id], count: 2 });
  const signal = AbortSignal.abort(new Error("job 1 was cancelled"));

  await expect(run({ signal, progress: () => undefined })).rejects.toThrow(/cancelled/);
  expect(omlx.requests).toHaveLength(0);
  expect(listEvaluations(app.store)).toEqual([]);
});

test("progress counts candidates across every vibe, and says which one is being asked for", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx, clock } = made;
  const vibes = ["cold-dorian", "bell-field"].map((id) =>
    createVibe(app.store, /** @type {any} */ (SEED_VIBES[id])),
  );
  // Answers with no JSON are rejected without a repair, so each vibe takes one request.
  omlx.script({ tokens: ["no genome"] }, { tokens: ["no genome"] });
  /** @type {[number, number, string | null][]} */
  const reports = [];
  const run = evaluationJob(app, { vibeIds: vibes.map(({ id }) => id), count: 1 });
  await driveGaps(
    clock,
    app.config.queue.minGapMs,
    run({
      signal: new AbortController().signal,
      progress: (done, total, step) => reports.push([done, total, step]),
    }),
  );
  expect(reports).toEqual([
    [0, 2, null],
    [0, 2, "Asking the model for candidate 1 of 2"],
    [1, 2, null],
    [1, 2, "Asking the model for candidate 2 of 2"],
    [2, 2, null],
  ]);
});

test("the evaluation's prompt carries no locks while the vibe has some", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx, clock } = made;
  const vibe = createVibe(app.store, /** @type {any} */ (SEED_VIBES["cold-dorian"]));
  const candidate = addCandidate(app.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(app.store, vibe.id, droneGenome).id,
    seed: 1,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  setLock(app.store, {
    vibeId: vibe.id,
    candidateId: candidate.id,
    path: "reverbDecay",
    value: droneGenome.reverbDecay,
    voiceType: null,
  });
  expect(locksInForce(app.store, vibe.id)).toHaveLength(1);
  omlx.script({ tokens: ["no genome"] });
  const run = evaluationJob(app, { vibeIds: [vibe.id], count: 1 });
  await driveGaps(
    clock,
    app.config.queue.minGapMs,
    run({ signal: new AbortController().signal, progress: () => undefined }),
  );
  expect(omlx.requests).toHaveLength(1);
  expect(omlx.requests[0]?.body.messages[1].content).not.toContain("Locked by the owner");
});

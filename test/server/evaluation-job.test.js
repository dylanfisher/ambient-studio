// The evaluation job run directly with a signal the test controls (decision 0030). No test
// reaches the real omlx.
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { evaluationJob } from "../../src/server/evaluation-job.js";
import { listEvaluations } from "../../src/server/evaluation-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
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

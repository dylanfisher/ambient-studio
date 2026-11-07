// The session's candidate job run directly with a signal the test controls (decision 0027). No
// test reaches the real omlx.
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { candidateJob } from "../../src/server/candidate-job.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { VIBE } from "../support/studio.js";
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

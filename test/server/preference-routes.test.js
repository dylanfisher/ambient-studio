// The fit job's route (decision 0044) through the HTTP server. The test config names no
// checkpoint folder, so the job fails at once, saying so, and nothing starts the sidecar.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { removeStudio, startStudio } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

test("POST /api/preference-models starts the fit job, which needs embeddings", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const job = await studio.ok("POST", "/api/preference-models", {});
  expect(job).toMatchObject({ kind: "fit" });
  await studio.server.jobs.settled(job.id);
  const status = await studio.ok("GET", `/api/jobs/${job.id}`);
  expect(status.state).toBe("failed");
  expect(status.error).toContain(NO_CHECKPOINT_CACHE);
});

test("a second POST while a fit job is unfinished is refused with its id", async () => {
  const studio = await startStudio();
  studios.push(studio);
  // A job that runs until it is cancelled, as stopping the server does.
  const running = studio.server.jobs.add(
    "fit",
    ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  );
  const reply = await studio.server.api("POST", "/api/preference-models", {});
  expect(reply.status).toBe(409);
  expect(reply.json()).toMatchObject({ jobId: running.id });
});

test("GET /api/vibes/:vibeId/preference says there is no taste model yet", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { vibe } = await studio.openSession();
  const summary = await studio.ok("GET", `/api/vibes/${vibe.id}/preference`);
  expect(summary).toMatchObject({ state: "none" });
  expect(summary.text).toMatch(/^No taste model yet\. /);
  const missing = await studio.server.api("GET", `/api/vibes/${vibe.id + 1}/preference`);
  expect(missing.status).toBe(404);
});

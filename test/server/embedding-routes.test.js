// The embed job's route (decision 0042) through the HTTP server. The test config names no
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

test("POST /api/embeddings starts the embed job, which says when no folder is set", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const job = await studio.ok("POST", "/api/embeddings", {});
  expect(job).toMatchObject({ kind: "embed" });
  await studio.server.jobs.settled(job.id);
  expect(await studio.ok("GET", `/api/jobs/${job.id}`)).toMatchObject({
    state: "failed",
    error: NO_CHECKPOINT_CACHE,
  });
});

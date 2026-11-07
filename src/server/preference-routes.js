// The preference model's routes (decisions 0044, 0045 and 0047): start the fit job and the
// taste model test, which nothing else starts, read the test's last report, and read a vibe's
// taste summary.
/** @import { App, Route } from "./routing.js" */
import { fitJob } from "./fit-job.js";
import { readPreferenceSummary } from "./preference-summary.js";
import { preferenceTestJob } from "./preference-test-job.js";
import { readPreferenceTest } from "./preference-test-store.js";
import { duplicateJob } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

const FIT_JOB = "fit";
const TEST_JOB = "agreement";

/**
 * The job of `kind` that is queued or running, if any.
 * @param {App} app
 * @param {string} kind
 */
const unfinishedJob = (app, kind) =>
  app.jobs.list().find((job) => job.kind === kind && job.finishedAt === null) ?? null;

/** @type {Route[]} */
export const PREFERENCE_ROUTES = [
  {
    method: "POST",
    path: "/api/preference-models",
    handle: ({ app }) => {
      // One at a time: a second would fit the same keys again.
      const unfinished = unfinishedJob(app, FIT_JOB);
      if (unfinished) {
        throw duplicateJob(
          `The fit job is already queued or running (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      return app.jobs.add(FIT_JOB, fitJob(app));
    },
  },
  {
    method: "GET",
    path: "/api/vibes/:vibeId/preference",
    handle: ({ app, params }) => {
      const vibe = requireVibe(app.store, params);
      // Never cancelled, even when the page closes: cancelling a sidecar request stops the
      // process, which would fail a job's request in flight beside it. The client's timeout
      // still bounds the wait.
      return readPreferenceSummary(app, vibe.id, new AbortController().signal);
    },
  },
  {
    method: "GET",
    path: "/api/preference-tests",
    handle: async ({ app }) => ({
      report: await readPreferenceTest(app.paths),
      job: unfinishedJob(app, TEST_JOB),
    }),
  },
  {
    method: "POST",
    path: "/api/preference-tests",
    handle: ({ app }) => {
      // One at a time: a second would fit the same folds again.
      const unfinished = unfinishedJob(app, TEST_JOB);
      if (unfinished) {
        throw duplicateJob(
          `The taste model test is already queued or running (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      return app.jobs.add(TEST_JOB, preferenceTestJob(app));
    },
  },
];

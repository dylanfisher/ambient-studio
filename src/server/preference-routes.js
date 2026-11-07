// The preference model's routes: start the fit job (decision 0044), which nothing else starts,
// and read a vibe's taste summary (0047).
/** @import { App, Route } from "./routing.js" */
import { fitJob } from "./fit-job.js";
import { readPreferenceSummary } from "./preference-summary.js";
import { duplicateJob } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

const FIT_JOB = "fit";

/**
 * The fit job that is queued or running, if any.
 * @param {App} app
 */
const unfinishedJob = (app) =>
  app.jobs.list().find((job) => job.kind === FIT_JOB && job.finishedAt === null) ?? null;

/** @type {Route[]} */
export const PREFERENCE_ROUTES = [
  {
    method: "POST",
    path: "/api/preference-models",
    handle: ({ app }) => {
      // One at a time: a second would fit the same keys again.
      const unfinished = unfinishedJob(app);
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
];

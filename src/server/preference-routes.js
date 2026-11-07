// The preference model's route (decision 0044): start the fit job. Nothing else starts it.
/** @import { App, Route } from "./routing.js" */
import { fitJob } from "./fit-job.js";
import { duplicateJob } from "./routing.js";

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
];

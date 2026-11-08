// The embedding route (decision 0042): start the embed job. Nothing else starts it.
/** @import { App, Route } from "./routing.js" */
import { JOB_KIND } from "../domain/job-kind.js";
import { embedJob } from "./embed-job.js";
import { duplicateJob } from "./routing.js";

const EMBED_JOB = JOB_KIND.embed;

/**
 * The embed job that is queued or running, if any.
 * @param {App} app
 */
const unfinishedJob = (app) =>
  app.jobs.list().find((job) => job.kind === EMBED_JOB && job.finishedAt === null) ?? null;

/** @type {Route[]} */
export const EMBEDDING_ROUTES = [
  {
    method: "POST",
    path: "/api/embeddings",
    handle: ({ app }) => {
      // One at a time: a second would find the same rows missing and embed them twice.
      const unfinished = unfinishedJob(app);
      if (unfinished) {
        throw duplicateJob(
          `The embed job is already queued or running (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      return app.jobs.add(EMBED_JOB, embedJob(app));
    },
  },
];

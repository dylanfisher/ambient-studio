// The evaluation routes (decision 0030): start an evaluation over some vibes as a job, and read
// the stored reports. Nothing else starts one.
/** @import { App, Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { EVALUATION_COUNT } from "../domain/evaluation-size.js";
import { show } from "../engine/validation-error.js";
import { evaluationJob } from "./evaluation-job.js";
import { getEvaluation, listEvaluations } from "./evaluation-store.js";
import { fields, idParam, integer } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { getVibe } from "./vibe-store.js";

const EVALUATION_JOB = "evaluation";

/**
 * The evaluation job that is queued or running, if any.
 * @param {App} app
 */
const unfinishedJob = (app) =>
  app.jobs.list().find((job) => job.kind === EVALUATION_JOB && job.finishedAt === null) ?? null;

/**
 * The body's `vibeIds`: at least one, each a vibe not removed, none twice, since a vibe's
 * request group is named by the run's one stream seed.
 * @param {Store} store
 * @param {Record<string, unknown>} body
 * @returns {number[]}
 */
function readVibeIds(store, body) {
  const { vibeIds } = body;
  if (!Array.isArray(vibeIds) || vibeIds.length === 0) {
    throw new HttpError(400, `vibeIds must list at least one vibe id, got ${show(vibeIds)}`);
  }
  const ids = vibeIds.map((id, i) => {
    if (!Number.isInteger(id) || id < 1) {
      throw new HttpError(400, `vibeIds[${i}] must be a vibe id, got ${show(id)}`);
    }
    return /** @type {number} */ (id);
  });
  for (const [i, id] of ids.entries()) {
    if (ids.indexOf(id) < i) throw new HttpError(400, `vibeIds lists vibe ${id} twice`);
    const vibe = getVibe(store, id);
    if (!vibe || vibe.removedAt !== null) {
      throw new HttpError(400, `vibeIds[${i}]: there is no vibe ${id}`);
    }
  }
  return ids;
}

/** @type {Route[]} */
export const EVALUATION_ROUTES = [
  {
    method: "GET",
    path: "/api/evaluations",
    handle: ({ app }) => ({ evaluations: listEvaluations(app.store), job: unfinishedJob(app) }),
  },
  {
    method: "POST",
    path: "/api/evaluations",
    handle: async ({ app, body }) => {
      const given = fields(await body(), ["vibeIds", "count"]);
      const vibeIds = readVibeIds(app.store, given);
      const count = integer(given, "count", { min: 1, max: EVALUATION_COUNT.max });
      // One at a time: a second would double the hours omlx is held, and is most likely a
      // second click.
      const unfinished = unfinishedJob(app);
      if (unfinished) {
        throw new HttpError(
          409,
          `evaluation job ${unfinished.id} hasn't finished; wait or cancel it`,
        );
      }
      return app.jobs.add(EVALUATION_JOB, evaluationJob(app, { vibeIds, count }));
    },
  },
  {
    method: "GET",
    path: "/api/evaluations/:evaluationId",
    handle: ({ app, params }) => {
      const id = idParam(params, "evaluationId");
      const evaluation = getEvaluation(app.store, id);
      if (!evaluation || evaluation.removedAt !== null) {
        throw new HttpError(404, `there is no evaluation ${id}`);
      }
      return evaluation;
    },
  },
];

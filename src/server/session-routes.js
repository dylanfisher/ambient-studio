// The session and job routes (decision 0027): a session's state and stop, asking for
// candidates, re-rendering missing excerpts, the candidates with their excerpts, and job status
// and cancel. Stopping a session cancels its jobs, and with them their omlx requests.
/** @import { JobStatus } from "./job-runner.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Session } from "./session-store.js" */
import { currentExcerpt } from "./candidate-excerpt.js";
import { candidateJob, DEFAULT_CANDIDATES, excerptJob, MAX_CANDIDATES } from "./candidate-job.js";
import { getGenome, listSessionCandidates } from "./generation-store.js";
import { fields, idParam, integer } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { getSession, stopSession } from "./session-store.js";

/**
 * The session named by the path, or a 404.
 * @param {App} app
 * @param {Record<string, string>} params
 * @returns {Session}
 */
function requireSession(app, params) {
  const id = idParam(params, "sessionId");
  const session = getSession(app.store, id);
  if (!session) throw new HttpError(404, `there is no session ${id}`);
  return session;
}

/**
 * The session named by the path, or a 404, or a 409 once it has stopped: a stopped session
 * takes no more jobs or ratings.
 * @param {App} app
 * @param {Record<string, string>} params
 * @returns {Session}
 */
export function requireOpenSession(app, params) {
  const session = requireSession(app, params);
  if (session.stoppedAt !== null) throw new HttpError(409, `session ${session.id} has stopped`);
  return session;
}

/**
 * @param {App} app
 * @param {Record<string, string>} params
 * @returns {JobStatus}
 */
function requireJob(app, params) {
  const id = idParam(params, "jobId");
  if (!app.jobs.list().some((job) => job.id === id)) {
    throw new HttpError(404, `there is no job ${id}`);
  }
  return app.jobs.get(id);
}

/**
 * The session with the statuses of the jobs it added since the server started, without their
 * results.
 * @param {App} app
 * @param {Session} session
 */
function sessionView(app, session) {
  const ids = app.sessionJobs.get(session.id) ?? [];
  const jobs = app.jobs.list().filter((job) => ids.includes(job.id));
  return { ...session, jobs };
}

/**
 * @param {App} app
 * @param {Session} session
 * @param {string} kind
 * @param {Parameters<App["jobs"]["add"]>[1]} run
 * @returns {JobStatus}
 */
function addSessionJob(app, session, kind, run) {
  const status = app.jobs.add(kind, run);
  app.sessionJobs.set(session.id, [...(app.sessionJobs.get(session.id) ?? []), status.id]);
  return status;
}

/** @type {Route[]} */
export const SESSION_ROUTES = [
  {
    method: "GET",
    path: "/api/sessions/:sessionId",
    handle: ({ app, params }) => sessionView(app, requireSession(app, params)),
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/stop",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      fields(await body(), []);
      stopSession(app.store, session.id);
      // A queued job is dropped; a running one's signal aborts, and the candidate job cancels
      // the omlx queue when it does.
      for (const id of app.sessionJobs.get(session.id) ?? []) app.jobs.cancel(id);
      return sessionView(app, requireSession(app, params));
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/candidates",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), ["count"]);
      const count =
        given.count === undefined
          ? DEFAULT_CANDIDATES
          : integer(given, "count", { min: 1, max: MAX_CANDIDATES });
      const run = candidateJob(app, { vibeId: session.vibeId, sessionId: session.id, count });
      return addSessionJob(app, session, "candidates", run);
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/excerpts",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      fields(await body(), []);
      const run = excerptJob(app, listSessionCandidates(app.store, session.id));
      return addSessionJob(app, session, "excerpts", run);
    },
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/candidates",
    handle: ({ app, params }) => {
      const session = requireSession(app, params);
      const candidates = listSessionCandidates(app.store, session.id).map((candidate) => {
        const render = currentExcerpt(app.store, app.paths.renderCache, candidate);
        const excerpt = render && {
          renderId: render.id,
          url: `/audio/${render.id}`,
          offset: render.offset,
          duration: render.duration,
          target: render.target,
          features: render.features,
          checks: render.checks,
        };
        const { id, genomeId, seed, intent, rejectReason, lint, createdAt } = candidate;
        const genome = genomeId === null ? null : (getGenome(app.store, genomeId)?.genome ?? null);
        return { id, genomeId, seed, intent, rejectReason, lint, genome, createdAt, excerpt };
      });
      return { candidates };
    },
  },
  {
    method: "GET",
    path: "/api/jobs",
    handle: ({ app }) => ({ jobs: app.jobs.list() }),
  },
  {
    method: "GET",
    path: "/api/jobs/:jobId",
    handle: ({ app, params }) => requireJob(app, params),
  },
  {
    method: "POST",
    path: "/api/jobs/:jobId/cancel",
    handle: async ({ app, params, body }) => {
      const { id } = requireJob(app, params);
      fields(await body(), []);
      return app.jobs.cancel(id);
    },
  },
];

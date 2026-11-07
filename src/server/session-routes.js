// The session and job routes (decision 0027): a session's state and stop, asking for
// candidates, re-rendering missing excerpts, the candidates with their excerpts and revised
// pairs (0036), and job status and cancel. Stopping a session cancels its jobs, and with them
// their omlx requests.
/** @import { JobStatus } from "./job-runner.js" */
/** @import { Feedback } from "./rating-store.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Session } from "./session-store.js" */
import { currentExcerpt } from "./candidate-excerpt.js";
import { candidateJob, DEFAULT_CANDIDATES, excerptJob, MAX_CANDIDATES } from "./candidate-job.js";
import { candidatePairs } from "./candidate-pair.js";
import { getGenome, listSessionCandidates } from "./generation-store.js";
import { FEEDBACK_KIND, listSessionFeedback } from "./rating-store.js";
import { fields, idParam, integer } from "./request-fields.js";
import { duplicateJob, HttpError } from "./routing.js";
import { getSession, stopSession } from "./session-store.js";

/**
 * A candidate's live feedback, with the ids a remove names (decision 0031): its thumbs, and each
 * macro's direction, keyed by macro, holding only the macros it has one for.
 * @typedef {object} FeedbackState
 * @property {{ id: number, direction: string, note: string | null } | null} thumbs
 * @property {Record<string, { id: number, direction: string }>} macros
 */

/**
 * @param {readonly Feedback[]} live the session's live feedback
 * @param {{ genomeId: number | null, seed: number }} candidate
 * @returns {FeedbackState}
 */
function feedbackState(live, { genomeId, seed }) {
  /** @type {FeedbackState} */
  const state = { thumbs: null, macros: {} };
  for (const { id, kind, direction, note, macro, ...row } of live) {
    if (row.genomeId !== genomeId || row.seed !== seed) continue;
    if (kind === FEEDBACK_KIND.thumbs) state.thumbs = { id, direction, note };
    else if (macro !== null) state.macros[macro] = { id, direction };
  }
  return state;
}

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

const CANDIDATES = "candidates";
const EXCERPTS = "excerpts";

/** What a refused second job of each kind tells the owner, naming the unfinished one. */
const DUPLICATE = Object.freeze({
  /** @param {number} id */
  [CANDIDATES]: (id) =>
    `This session is already asking for candidates (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [EXCERPTS]: (id) =>
    `This session is already rendering its excerpts (job ${id}). Wait for it to finish, or cancel it.`,
});

/**
 * The session's job of `kind` that is queued or running, if any.
 * @param {App} app
 * @param {Session} session
 * @param {string} kind
 */
function unfinishedJob(app, session, kind) {
  const ids = app.sessionJobs.get(session.id) ?? [];
  return (
    app.jobs
      .list()
      .find((job) => ids.includes(job.id) && job.kind === kind && job.finishedAt === null) ?? null
  );
}

/**
 * Adds the job, unless the session has one of the same kind queued or running, or `coveredBy`
 * names a kind whose unfinished job does the same work: each is a 409 naming that job, since a
 * second is most likely the same click sent twice. The check and the add run with no await
 * between them, so two requests at once can't both pass it.
 * @param {App} app
 * @param {Session} session
 * @param {keyof typeof DUPLICATE} kind
 * @param {Parameters<App["jobs"]["add"]>[1]} run
 * @returns {JobStatus}
 */
function addSessionJob(app, session, kind, run) {
  const same = unfinishedJob(app, session, kind);
  if (same) throw duplicateJob(DUPLICATE[kind](same.id), same.id);
  if (kind === EXCERPTS) {
    const generating = unfinishedJob(app, session, CANDIDATES);
    if (generating) {
      throw duplicateJob(
        `This session's candidates job (job ${generating.id}) renders the excerpts itself. Wait for it to finish.`,
        generating.id,
      );
    }
  }
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
      return addSessionJob(app, session, CANDIDATES, run);
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/excerpts",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      fields(await body(), []);
      const run = excerptJob(app, listSessionCandidates(app.store, session.id));
      return addSessionJob(app, session, EXCERPTS, run);
    },
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/candidates",
    handle: ({ app, params }) => {
      const session = requireSession(app, params);
      const live = listSessionFeedback(app.store, session.id);
      const listed = listSessionCandidates(app.store, session.id).map((candidate) => ({
        candidate,
        excerpt: currentExcerpt(app.store, app.paths.renderCache, candidate),
      }));
      const { pairs, folded } = candidatePairs(app.store, listed);
      const candidates = listed
        .filter(({ candidate }) => !folded.has(candidate.id))
        .map(({ candidate, excerpt: render }) => {
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
          const genome =
            genomeId === null ? null : (getGenome(app.store, genomeId)?.genome ?? null);
          const feedback = feedbackState(live, candidate);
          return {
            id,
            genomeId,
            seed,
            intent,
            rejectReason,
            lint,
            genome,
            createdAt,
            operator: candidate.operator,
            parentIds: candidate.parentIds,
            pair: pairs.get(id) ?? null,
            excerpt,
            feedback,
          };
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

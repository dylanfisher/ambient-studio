// The session and job routes (decision 0027): a session's state and stop, asking for
// candidates, nudging (0037) and exploring (0038) from one, re-rendering missing excerpts, the
// candidates with their excerpts and revised pairs (0036), and job status and cancel. Stopping a
// session cancels its jobs, and with them their omlx requests.
/** @import { JobStatus } from "./job-runner.js" */
/** @import { Feedback } from "./rating-store.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Session } from "./session-store.js" */
import { applyLocks } from "../domain/apply-locks.js";
import { NOT_ONE_LINE } from "../domain/explore-direction.js";
import { lockRefusal, STEP_SIZE } from "../domain/nudge.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import {
  candidateJob,
  DEFAULT_CANDIDATES,
  DEFAULT_EXPLORES,
  excerptJob,
  MAX_CANDIDATES,
} from "./candidate-job.js";
import { candidatePairs } from "./candidate-pair.js";
import { EXPLORE_OPERATOR } from "./generate-candidates.js";
import { getGenome, listSessionCandidates } from "./generation-store.js";
import { CANDIDATE_ID, vibeCandidate } from "./lock-routes.js";
import { locksInForce } from "./lock-store.js";
import { DEFAULT_NUDGES, NUDGE_OPERATOR, nudgeJob } from "./nudge-job.js";
import { FEEDBACK_KIND, listSessionFeedback } from "./rating-store.js";
import { fields, idParam, integer, MAX_CHARS, oneOf, rowId, text } from "./request-fields.js";
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
/** A nudge job is named for the operator its children store. */
const NUDGE = NUDGE_OPERATOR;
const EXPLORE = EXPLORE_OPERATOR;
const STEP_SIZES = /** @type {(keyof typeof STEP_SIZE)[]} */ (Object.keys(STEP_SIZE));

/** What a refused second job of each kind tells the owner, naming the unfinished one. */
const DUPLICATE = Object.freeze({
  /** @param {number} id */
  [CANDIDATES]: (id) =>
    `This session is already asking for candidates (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [EXCERPTS]: (id) =>
    `This session is already rendering its excerpts (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [NUDGE]: (id) =>
    `This session is already making this nudge (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [EXPLORE]: (id) =>
    `This session is already making this explore (job ${id}). Wait for it to finish, or cancel it.`,
});

/**
 * An explore's direction, or null when the body gives none or only white space (decision 0038).
 * @param {Record<string, unknown>} given
 * @returns {string | null}
 */
function direction(given) {
  if (given.direction === undefined || given.direction === null) return null;
  const line = text(given, "direction", MAX_CHARS.direction, { allowEmpty: true });
  if (NOT_ONE_LINE.test(line)) {
    throw new HttpError(400, "direction must be one line of text, with no control characters");
  }
  return line.trim() === "" ? null : line;
}

/**
 * The candidate a job starts from, checked to take the vibe's locks: a 409 otherwise, so the
 * owner hears now. The job applies the locks live when it starts.
 * @param {App} app
 * @param {Session} session
 * @param {number} candidateId
 */
function baseCandidate(app, session, candidateId) {
  const found = vibeCandidate(app.store, session.vibeId, candidateId);
  const refused = lockRefusal(applyLocks(found.genome, locksInForce(app.store, session.vibeId)));
  if (refused !== null) throw new HttpError(409, `candidate ${candidateId} ${refused}`);
  return found;
}

/**
 * What each app's jobs were asked to do beyond their kind, by job id: a nudge's base, step size
 * and count. A job added without one matches any job of its kind.
 * @type {WeakMap<App, Map<number, string>>}
 */
const jobActions = new WeakMap();

/**
 * The session's job of `kind` that is queued or running, if any, and when `action` is given, one
 * added for that action.
 * @param {App} app
 * @param {Session} session
 * @param {string} kind
 * @param {string} [action]
 */
function unfinishedJob(app, session, kind, action) {
  const ids = app.sessionJobs.get(session.id) ?? [];
  const actions = jobActions.get(app);
  return (
    app.jobs
      .list()
      .find(
        (job) =>
          ids.includes(job.id) &&
          job.kind === kind &&
          job.finishedAt === null &&
          (action === undefined || actions?.get(job.id) === action),
      ) ?? null
  );
}

/**
 * Adds the job, unless the session has one of the same kind queued or running, for the same
 * `action` when one is given, or an excerpts job while its candidates job renders them: each is
 * a 409 naming that job, since a second is most likely the same click sent twice (decision
 * 0031). The check and the add run with no await between them, so two requests at once can't
 * both pass it.
 * @param {App} app
 * @param {Session} session
 * @param {keyof typeof DUPLICATE} kind
 * @param {Parameters<App["jobs"]["add"]>[1]} run
 * @param {string} [action] what the job does beyond its kind, as a nudge's base, step size and
 *   count; a job of the kind for another action is accepted and queues
 * @returns {JobStatus}
 */
function addSessionJob(app, session, kind, run, action) {
  const same = unfinishedJob(app, session, kind, action);
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
  if (action !== undefined) {
    const actions = jobActions.get(app) ?? new Map();
    actions.set(status.id, action);
    jobActions.set(app, actions);
  }
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
    path: "/api/sessions/:sessionId/nudges",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [CANDIDATE_ID, "stepSize", "count"]);
      const candidateId = rowId(given, CANDIDATE_ID);
      const stepSize = oneOf(given, "stepSize", STEP_SIZES);
      const count =
        given.count === undefined
          ? DEFAULT_NUDGES
          : integer(given, "count", { min: 1, max: MAX_CANDIDATES });
      const { candidate, genome } = baseCandidate(app, session, candidateId);
      const run = nudgeJob(app, {
        vibeId: session.vibeId,
        sessionId: session.id,
        base: candidate,
        genome,
        stepSize,
        count,
      });
      return addSessionJob(app, session, NUDGE, run, `${candidateId} ${stepSize} ${count}`);
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/explores",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [CANDIDATE_ID, "direction", "count"]);
      const candidateId = rowId(given, CANDIDATE_ID);
      const line = direction(given);
      const count =
        given.count === undefined
          ? DEFAULT_EXPLORES
          : integer(given, "count", { min: 1, max: MAX_CANDIDATES });
      const { candidate, genome } = baseCandidate(app, session, candidateId);
      const run = candidateJob(app, {
        vibeId: session.vibeId,
        sessionId: session.id,
        count,
        explore: { base: candidate, genome, direction: line },
      });
      // A direction may hold spaces, so the action is written as JSON.
      return addSessionJob(app, session, EXPLORE, run, JSON.stringify([candidateId, line, count]));
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

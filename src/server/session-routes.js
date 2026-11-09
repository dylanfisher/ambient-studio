// The session and job routes (decision 0027): a session's state and stop, asking for
// candidates, nudging (0037), exploring (0038), searching (0054) and steering (0056) from one,
// breeding two sketches (0058) and the breed's estimate, filling the brief's map (0057),
// re-rendering missing excerpts, the candidates with their excerpts, revised pairs (0036),
// places in the ranking (0046) and a search's shown points, hiding and showing them again
// (0049), and job status and cancel. Stopping a session cancels its jobs, and with them their
// omlx requests.
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobStatus } from "./job-runner.js" */
/** @import { IncomingMessage } from "node:http" */
/** @import { Playable } from "./ear-search-job.js" */
/** @import { Feedback, Rating } from "./rating-store.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Session } from "./session-store.js" */
import { applyLocks } from "../domain/apply-locks.js";
import { ATTACHMENT_KIND, MAX_DIRECTIONS, MAX_REFERENCES } from "../domain/attachment-kind.js";
import { DEFAULT_BREEDS, PARENT_NAME } from "../domain/breed-settings.js";
import {
  checkSteering,
  DEFAULT_EAR_QUERIES,
  EAR_PHASE,
  earScore,
  MAX_EAR_DIMENSIONS,
  MAX_EAR_QUERIES,
  START_STEERING,
} from "../domain/ear-settings.js";
import { DEFAULT_EXPLORES, NOT_ONE_LINE } from "../domain/explore-direction.js";
import { DEFAULT_FILL_BUDGET, MAX_FILL_BUDGET } from "../domain/fill-settings.js";
import { DEFAULT_NUDGES, lockRefusal, STEP_SIZE } from "../domain/nudge.js";
import { OPERATOR } from "../domain/operator.js";
import { percentiles } from "../domain/percentiles.js";
import {
  DEFAULT_SEARCH_BUDGET,
  DEFAULT_STEER_BUDGET,
  MAX_SEARCH_BUDGET,
} from "../domain/search-settings.js";
import { MAX_SEARCH_DIMENSIONS, searchSpace } from "../domain/search-space.js";
import { WORDS_CHARS } from "../domain/words-prompt.js";
import { isObject } from "../engine/is-object.js";
import { getAttachment } from "./attachment-store.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import { candidateJob, DEFAULT_CANDIDATES, excerptJob, MAX_CANDIDATES } from "./candidate-job.js";
import { candidatePairs } from "./candidate-pair.js";
import { createEarChannel, earChannel, earSearchJob, setEarChannel } from "./ear-search-job.js";
import { readShiftWords } from "./ear-shift.js";
import { fillJob } from "./fill-job.js";
import { BREED_OPERATOR, currentRevision, EXPLORE_OPERATOR } from "./generate-candidates.js";
import {
  getCandidate,
  getGenome,
  listSessionCandidates,
  recentLatencies,
} from "./generation-store.js";
import { HIDDEN, hiddenInSession, setHidden } from "./hide-store.js";
import { CANDIDATE_ID, vibeCandidate } from "./lock-routes.js";
import { locksInForce } from "./lock-store.js";
import { NUDGE_OPERATOR, nudgeJob } from "./nudge-job.js";
import { currentModel } from "./preference-summary.js";
import { FEEDBACK_KIND, getRating, getSketch, listSessionFeedback } from "./rating-store.js";
import {
  fields,
  finite,
  idParam,
  integer,
  MAX_CHARS,
  oneOf,
  rowId,
  text,
} from "./request-fields.js";
import { duplicateJob, HttpError, wrongType } from "./routing.js";
import { readSearchResults, searchEstimate, searchJob, searchRefusal } from "./search-job.js";
import { readRanking } from "./session-ranking.js";
import { getSession, stopSession } from "./session-store.js";
import { readChosenSteering, steerJob } from "./steer-job.js";
import { archiveContext } from "./vibe-archive.js";

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
/** A search job is named for the operator its points store. */
const SEARCH = OPERATOR.optimize;
/** A search by ear is named for the operator its points store. */
const EAR = OPERATOR.optimizeEar;
/** A steer is named for the operator its points store. */
const STEER = OPERATOR.steer;
/** A breed is named for the operator its children store. */
const BREED = BREED_OPERATOR;
/** The requests the model answered that a breed's estimate takes its median from. */
const RECENT_REQUESTS = 20;
/** The map's fill is named for the operator its children store (decision 0057). */
const FILL = OPERATOR.elite;
/** The type a browser labels a beacon's string body with. */
const BEACON_TYPE = "text/plain";
const STEP_SIZES = /** @type {(keyof typeof STEP_SIZE)[]} */ (Object.keys(STEP_SIZE));
/** The most candidates one hide names; the page sends one, or the two of a revised pair. */
const MAX_HIDES = 64;

/**
 * The candidates a hide names, each checked to be of the session: a 400 otherwise.
 * @param {App} app
 * @param {Session} session
 * @param {Record<string, unknown>} given
 * @returns {number[]}
 */
function hideIds(app, session, given) {
  const list = given.candidateIds;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_HIDES) {
    throw new HttpError(
      400,
      `candidateIds must be a list of 1 to ${MAX_HIDES} ids, got ${JSON.stringify(list)}`,
    );
  }
  return list.map((value, i) => {
    const id = rowId({ [`candidateIds[${i}]`]: value }, `candidateIds[${i}]`);
    if (getCandidate(app.store, id)?.sessionId !== session.id) {
      throw new HttpError(400, `candidate ${id} is not of session ${session.id}`);
    }
    return id;
  });
}

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
  /** @param {number} id */
  [SEARCH]: (id) =>
    `This session is already running this search (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [STEER]: (id) =>
    `This session is already running this steer (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [BREED]: (id) =>
    `This session is already breeding these sketches (job ${id}). Wait for it to finish, or cancel it.`,
  /** @param {number} id */
  [EAR]: (id) =>
    `This session is already searching by ear (job ${id}). Finish or stop it on the Quick A/B page first.`,
  /** @param {number} id */
  [FILL]: (id) =>
    `This session is already filling the map (job ${id}). Wait for it to finish, or cancel it.`,
});

/**
 * The session's latest search by ear, or a 404.
 * @param {App} app
 * @param {Session} session
 */
function requireEarChannel(app, session) {
  const channel = earChannel(app, session.id);
  if (!channel) {
    throw new HttpError(
      404,
      `Session ${session.id} has had no search by ear since the studio started. Start one with Search by ear on a candidate on the session page.`,
    );
  }
  return channel;
}

/**
 * Whether the request is the Quick A/B page's `navigator.sendBeacon` as it closes (decision
 * 0055): a string body, which the browser labels `text/plain`; some browsers' `sendBeacon`
 * refuses a Blob labeled JSON. Every other route takes only JSON, which a page on another site
 * can't send here without a preflight (0025); a text body can be sent from anywhere, so a
 * beacon must also carry an `Origin` naming this server's own host, which the browser sets and
 * a page can't change.
 * Throws a 403 for a text body from anywhere else.
 * @param {IncomingMessage} request
 */
function isBeacon(request) {
  if (wrongType(request, BEACON_TYPE)) return false;
  const { origin, host } = request.headers;
  /** @type {string | null} */
  let from = null;
  try {
    from = origin === undefined ? null : new URL(origin).host;
  } catch {
    // An Origin that isn't a URL names no host, and is refused below.
  }
  if (from === null || from !== host) {
    throw new HttpError(403, "a text body is taken only from this studio's own pages");
  }
  return true;
}

/**
 * Which of the rating's sides holds `challenger` when its other side holds `best`, matched by
 * genome and seed as a rating names what was heard; null when the rating is of another pair.
 * @param {Rating} rating
 * @param {Playable} challenger
 * @param {Playable} best
 * @returns {"a" | "b" | null}
 */
function sideOf({ a, b }, challenger, best) {
  /** @param {{ genomeId: number, seed: number }} side @param {Playable} candidate */
  const is = (side, candidate) =>
    side.genomeId === candidate.genomeId && side.seed === candidate.seed;
  if (is(a, challenger) && is(b, best)) return "a";
  if (is(b, challenger) && is(a, best)) return "b";
  return null;
}

/**
 * A search's raw paths from the body: none when it gives none, or a list of strings.
 * @param {Record<string, unknown>} given
 * @returns {string[]}
 */
function rawPaths(given) {
  if (given.paths === undefined) return [];
  const list = given.paths;
  if (
    !Array.isArray(list) ||
    list.length > MAX_SEARCH_DIMENSIONS ||
    !list.every((path) => typeof path === "string")
  ) {
    throw new HttpError(
      400,
      `paths must be a list of at most ${MAX_SEARCH_DIMENSIONS} genome paths, got ${JSON.stringify(list)}`,
    );
  }
  return list;
}

/**
 * Each search point's place in the table (decision 0054), by candidate id, read from its run's
 * summary: whether it is shown, and otherwise the shown point it folds under. A point the run
 * hasn't scored yet folds under the run's best, or under its base before any is scored. A
 * steer's points (0056) are a search's. A search by ear's summary shows its best and folds every other point under it (0055).
 * @param {App} app
 * @param {readonly Candidate[]} candidates
 */
async function searchPlaces(app, candidates) {
  /** @type {Map<string, Awaited<ReturnType<typeof readSearchResults>>>} */
  const runs = new Map();
  /** @type {Map<number, { shown: boolean, foldedUnder: number | null, score: number | null }>} */
  const places = new Map();
  for (const candidate of candidates) {
    if (!(/** @type {(string | null)[]} */ ([SEARCH, STEER, EAR]).includes(candidate.operator))) {
      continue;
    }
    const run = String(/** @type {{ run?: unknown }} */ (candidate.operatorParams)?.run);
    if (!runs.has(run)) runs.set(run, await readSearchResults(app.paths.search, run));
    const results = runs.get(run) ?? null;
    const shown = results?.shown.includes(candidate.id) ?? false;
    const score =
      results?.evaluated.find(({ candidateId }) => candidateId === candidate.id)?.score ?? null;
    const foldedUnder = shown
      ? null
      : (results?.foldedUnder[candidate.id] ??
        results?.shown[0] ??
        /** @type {number} */ (candidate.parentIds[0]));
    places.set(candidate.id, { shown, foldedUnder, score });
  }
  return places;
}

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
 * The two sketches a breed names, A first: a 400 unless the body gives two different ids.
 * @param {Record<string, unknown>} given
 * @returns {[number, number]}
 */
function breedSketchIds(given) {
  const list = given.sketchIds;
  if (!Array.isArray(list) || list.length !== 2 || list[0] === list[1]) {
    throw new HttpError(
      400,
      `sketchIds must be a list of two different sketch ids, got ${JSON.stringify(list)}`,
    );
  }
  const [a, b] = list.map((value, i) => rowId({ [`sketchIds[${i}]`]: value }, `sketchIds[${i}]`));
  return [/** @type {number} */ (a), /** @type {number} */ (b)];
}

/**
 * The sketch a breed names, or a 400 when there is none or it was removed.
 * @param {App} app
 * @param {number} sketchId
 */
function liveSketch(app, sketchId) {
  const sketch = getSketch(app.store, sketchId);
  if (!sketch) throw new HttpError(400, `there is no sketch ${sketchId}`);
  if (sketch.removedAt !== null) {
    throw new HttpError(400, `sketch ${sketchId} was removed (${sketch.removedReason})`);
  }
  return sketch;
}

/**
 * A breed's parent: the candidate a sketch keeps, checked as a nudge's base is, and to take the
 * vibe's locks, a 409 otherwise (decision 0058).
 * @param {App} app
 * @param {Session} session
 * @param {{ candidateId: number }} sketch
 * @param {string} name from `PARENT_NAME`
 */
function sketchParent(app, session, sketch, name) {
  const found = vibeCandidate(app.store, session.vibeId, sketch.candidateId);
  const refused = lockRefusal(applyLocks(found.genome, locksInForce(app.store, session.vibeId)));
  if (refused !== null) {
    throw new HttpError(409, `${name}, candidate ${found.candidate.id}, ${refused}`);
  }
  return found;
}

/**
 * The attachment of `kind` live on the vibe that the body names at `key`, or a 400.
 * @param {App} app
 * @param {number} vibeId
 * @param {Record<string, unknown>} given
 * @param {string} key
 * @param {string} kind
 * @param {(id: number) => string} refusal the 400's message
 */
function liveAttachment(app, vibeId, given, key, kind, refusal) {
  const id = rowId(given, key);
  const attachment = getAttachment(app.store, id);
  if (attachment?.vibeId !== vibeId || attachment.kind !== kind || attachment.removedAt !== null) {
    throw new HttpError(400, refusal(id));
  }
  return id;
}

/**
 * A steer's choices from the body (decision 0056): each direction with its slider's setting,
 * from 0 to 1, and the regions to steer toward, each a live attachment of the vibe named once.
 * At least one of either; none is a 400.
 * @param {App} app
 * @param {number} vibeId
 * @param {Record<string, unknown>} given
 * @returns {import("./vibe-steering.js").SteerChoices}
 */
function steerChoices(app, vibeId, given) {
  /**
   * @param {string} key
   * @param {number} most
   * @returns {unknown[]}
   */
  const list = (key, most) => {
    const value = given[key] ?? [];
    if (!Array.isArray(value) || value.length > most) {
      throw new HttpError(
        400,
        `${key} must be a list of at most ${most}, got ${JSON.stringify(value)}`,
      );
    }
    return value;
  };
  const directions = list("directions", MAX_DIRECTIONS).map((entry, i) => {
    const key = `directions[${i}]`;
    if (!isObject(entry)) {
      throw new HttpError(400, `${key} must be {id, setting}, got ${JSON.stringify(entry)}`);
    }
    const one = fields(entry, ["id", "setting"]);
    const id = liveAttachment(
      app,
      vibeId,
      one,
      "id",
      ATTACHMENT_KIND.direction,
      (n) => `direction ${n} isn't attached to this brief`,
    );
    const { setting } = one;
    if (typeof setting !== "number" || !(setting >= 0 && setting <= 1)) {
      throw new HttpError(
        400,
        `${key}.setting must be a number from 0 to 1, got ${JSON.stringify(setting)}`,
      );
    }
    return { id, setting };
  });
  const regions = list("regions", MAX_REFERENCES).map((_, i) =>
    liveAttachment(
      app,
      vibeId,
      { [`regions[${i}]`]: /** @type {unknown[]} */ (given.regions)[i] },
      `regions[${i}]`,
      ATTACHMENT_KIND.reference,
      (n) => `attachment ${n} isn't a region attached to this brief`,
    ),
  );
  const ids = [...directions.map(({ id }) => id), ...regions];
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, "a steer names each direction and region at most once");
  }
  if (ids.length === 0) {
    throw new HttpError(400, "Move a slider or choose a region to steer toward first.");
  }
  // Sorted by id, so the same choices in another order are the same steer.
  return {
    directions: directions.sort((a, b) => a.id - b.id),
    regions: regions.sort((a, b) => a - b),
  };
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
    path: "/api/sessions/:sessionId/breeds",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), ["sketchIds", "count"]);
      const sketchIds = breedSketchIds(given);
      const count =
        given.count === undefined
          ? DEFAULT_BREEDS
          : integer(given, "count", { min: 1, max: MAX_CANDIDATES });
      const [a, b] = [liveSketch(app, sketchIds[0]), liveSketch(app, sketchIds[1])];
      if (a.candidateId === b.candidateId) {
        throw new HttpError(
          400,
          `sketches ${a.id} and ${b.id} keep the same candidate, ${a.candidateId}; choose sketches of two different candidates`,
        );
      }
      const parentA = sketchParent(app, session, a, PARENT_NAME.a);
      const parentB = sketchParent(app, session, b, PARENT_NAME.b);
      const run = candidateJob(app, {
        vibeId: session.vibeId,
        sessionId: session.id,
        count,
        breed: {
          a: { base: parentA.candidate, genome: parentA.genome, direction: null },
          b: { base: parentB.candidate, genome: parentB.genome, direction: null },
          sketchIds,
        },
      });
      // A and B play different parts in the prompt, so the order is part of the action.
      return addSessionJob(app, session, BREED, run, JSON.stringify([...sketchIds, count]));
    },
  },
  {
    method: "GET",
    path: "/api/breed-estimate",
    handle: ({ app }) => {
      const latencies = recentLatencies(app.store, RECENT_REQUESTS);
      return {
        seconds: latencies.length === 0 ? null : percentiles(latencies).p50 / 1000,
        timed: latencies.length,
      };
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/searches",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [CANDIDATE_ID, "budget", "paths", "control"]);
      const candidateId = rowId(given, CANDIDATE_ID);
      const budget =
        given.budget === undefined
          ? DEFAULT_SEARCH_BUDGET
          : integer(given, "budget", { min: 1, max: MAX_SEARCH_BUDGET });
      const raw = rawPaths(given);
      const control = given.control ?? false;
      if (typeof control !== "boolean") {
        throw new HttpError(400, `control must be true or false, got ${JSON.stringify(control)}`);
      }
      const { candidate, genome } = baseCandidate(app, session, candidateId);
      const locks = locksInForce(app.store, session.vibeId);
      const { constraints } = currentRevision(app.store, session.vibeId);
      try {
        if (searchSpace(applyLocks(genome, locks).genome, locks, constraints, raw).length === 0) {
          throw new HttpError(
            409,
            "Every macro is locked or fixed by the brief, so there is nothing to search. Unlock a macro, or choose paths to search.",
          );
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, /** @type {Error} */ (error).message);
      }
      const why = searchRefusal(
        await currentModel(app, session.vibeId, new AbortController().signal),
      );
      if (why !== null) throw new HttpError(409, why);
      const run = searchJob(app, {
        vibeId: session.vibeId,
        sessionId: session.id,
        base: candidate,
        genome,
        budget,
        raw,
        control,
      });
      const action = JSON.stringify([candidateId, budget, raw, control]);
      return addSessionJob(app, requireOpenSession(app, params), SEARCH, run, action);
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/steers",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [CANDIDATE_ID, "budget", "directions", "regions"]);
      const candidateId = rowId(given, CANDIDATE_ID);
      const budget =
        given.budget === undefined
          ? DEFAULT_STEER_BUDGET
          : integer(given, "budget", { min: 1, max: MAX_SEARCH_BUDGET });
      const choices = steerChoices(app, session.vibeId, given);
      const { candidate, genome } = baseCandidate(app, session, candidateId);
      const locks = locksInForce(app.store, session.vibeId);
      const { constraints } = currentRevision(app.store, session.vibeId);
      if (searchSpace(applyLocks(genome, locks).genome, locks, constraints, []).length === 0) {
        throw new HttpError(
          409,
          "Every macro is locked or fixed by the brief, so there is nothing to steer. Unlock a macro first.",
        );
      }
      // No taste model is needed: a steer scores by the sliders and regions (decision 0056).
      const why = await readChosenSteering(
        app,
        session.vibeId,
        choices,
        new AbortController().signal,
      );
      if (typeof why === "string") throw new HttpError(409, why);
      const run = steerJob(app, {
        vibeId: session.vibeId,
        sessionId: session.id,
        base: candidate,
        genome,
        budget,
        choices,
      });
      const action = JSON.stringify([candidateId, budget, choices]);
      return addSessionJob(app, requireOpenSession(app, params), STEER, run, action);
    },
  },
  {
    method: "GET",
    path: "/api/search-estimate",
    handle: ({ app }) => searchEstimate(app.paths.search),
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/fills",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), ["budget", "exploreShare", "control"]);
      const budget =
        given.budget === undefined
          ? DEFAULT_FILL_BUDGET
          : integer(given, "budget", { min: 1, max: MAX_FILL_BUDGET });
      const exploreShare =
        given.exploreShare === undefined ? 0 : finite(given, "exploreShare", { min: 0, max: 1 });
      const control = given.control ?? true;
      if (typeof control !== "boolean") {
        throw new HttpError(400, `control must be true or false, got ${JSON.stringify(control)}`);
      }
      const { reason } = await archiveContext(app, session.vibeId, new AbortController().signal);
      if (reason !== null) throw new HttpError(409, reason);
      const request = {
        vibeId: session.vibeId,
        sessionId: session.id,
        budget,
        exploreShare,
        control,
      };
      return addSessionJob(app, requireOpenSession(app, params), FILL, fillJob(app, request));
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ear-searches",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [CANDIDATE_ID, "queries", "paths"]);
      const candidateId = rowId(given, CANDIDATE_ID);
      const budget =
        given.queries === undefined
          ? DEFAULT_EAR_QUERIES
          : integer(given, "queries", { min: 1, max: MAX_EAR_QUERIES });
      const raw = rawPaths(given);
      const { candidate, genome } = baseCandidate(app, session, candidateId);
      const locks = locksInForce(app.store, session.vibeId);
      const { constraints } = currentRevision(app.store, session.vibeId);
      /** @type {string[]} */
      let space;
      try {
        space = searchSpace(applyLocks(genome, locks).genome, locks, constraints, raw);
      } catch (error) {
        throw new HttpError(400, /** @type {Error} */ (error).message);
      }
      if (space.length === 0) {
        throw new HttpError(
          409,
          "Every macro is locked or fixed by the brief, so there is nothing to search. Unlock a macro, or choose paths to search.",
        );
      }
      if (space.length > MAX_EAR_DIMENSIONS) {
        throw new HttpError(
          400,
          `A search by ear takes at most ${MAX_EAR_DIMENSIONS} dimensions, and these paths make ${space.length}.`,
        );
      }
      const channel = createEarChannel(budget, app.clock);
      const run = earSearchJob(
        app,
        {
          vibeId: session.vibeId,
          sessionId: session.id,
          base: candidate,
          genome,
          budget,
          raw,
        },
        channel,
      );
      const status = addSessionJob(app, session, EAR, run);
      channel.publish({ jobId: status.id });
      setEarChannel(app, session.id, channel);
      return status;
    },
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/ear-search",
    handle: ({ app, params }) => requireEarChannel(app, requireSession(app, params)).view(),
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ear-search/answers",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), ["query", "ratingId"]);
      const channel = requireEarChannel(app, session);
      const view = channel.view();
      const query = integer(given, "query", { min: 0, max: view.budget - 1 });
      const ratingId = rowId(given, "ratingId");
      const rating = getRating(app.store, ratingId);
      if (rating?.sessionId !== session.id || rating.removedAt !== null) {
        throw new HttpError(400, `session ${session.id} has no live A/B rating ${ratingId}`);
      }
      if (
        view.phase !== EAR_PHASE.listening ||
        view.query !== query ||
        !view.best ||
        !view.challenger
      ) {
        throw new HttpError(
          409,
          `The search by ear is not waiting for an answer to pair ${query + 1}.`,
        );
      }
      const side = sideOf(rating, view.challenger, view.best);
      if (side === null) {
        throw new HttpError(
          400,
          `A/B rating ${ratingId} is not of pair ${query + 1}'s two excerpts`,
        );
      }
      // A second post of one choice, racing the first, is refused here with a 409.
      channel.answer(query, earScore(rating.outcome, side));
      // The next pair is rendered ahead, so the reply waits only for the tell and its ask.
      return channel.after(query);
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ear-search/stop",
    handle: async ({ app, params, request, body }) => {
      // Stopping is not a rating, so a stopped session takes it too.
      const session = requireSession(app, params);
      if (isBeacon(request)) request.resume();
      else fields(await body(), []);
      const channel = requireEarChannel(app, session);
      channel.stop();
      return channel.view();
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ear-search/steering",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), Object.keys(START_STEERING));
      const channel = requireEarChannel(app, session);
      const view = channel.view();
      if (view.phase === EAR_PHASE.finished) {
        throw new HttpError(409, "This search by ear has ended, so it takes no more steering.");
      }
      if (view.paths.length === 0) {
        throw new HttpError(
          409,
          "The search by ear is still starting; steer it once its first pair shows.",
        );
      }
      const checked = checkSteering(given.variation, given.shift, view.paths);
      if (!checked.ok) throw new HttpError(400, checked.error);
      channel.steer(checked.steering);
      return channel.view();
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ear-search/shift-words",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), ["words"]);
      const words = text(given, "words", WORDS_CHARS);
      if (NOT_ONE_LINE.test(words)) throw new HttpError(400, "words must be one line");
      const channel = requireEarChannel(app, session);
      if (channel.view().phase === EAR_PHASE.finished) {
        throw new HttpError(409, "This search by ear has ended, so it takes no more steering.");
      }
      return readShiftWords(app, session, channel, words);
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
    method: "POST",
    path: "/api/sessions/:sessionId/hidden",
    handle: async ({ app, params, body }) => {
      // Hiding is not a rating, so a stopped session takes it too.
      const session = requireSession(app, params);
      const given = fields(await body(), ["candidateIds", HIDDEN]);
      if (typeof given.hidden !== "boolean") {
        throw new HttpError(
          400,
          `hidden must be true or false, got ${JSON.stringify(given.hidden)}`,
        );
      }
      // A revised pair takes one place on the page, so hiding is a fact about the pair.
      const { pairs } = candidatePairs(
        app.store,
        listSessionCandidates(app.store, session.id).map((candidate) => ({
          candidate,
          excerpt: null,
        })),
      );
      const ids = hideIds(app, session, given).flatMap((id) => {
        const pair = pairs.get(id);
        return pair ? [pair.firstTryId, pair.revisionId] : [id];
      });
      setHidden(app.store, ids, given.hidden);
      return { hidden: [...hiddenInSession(app.store, session.id)].sort((a, b) => a - b) };
    },
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/candidates",
    handle: async ({ app, params }) => {
      const session = requireSession(app, params);
      const ranking = await readRanking(app.paths, session.id);
      const places = new Map(
        (ranking?.excerpts ?? []).map(({ renderId, ...place }) => [renderId, place]),
      );
      const live = listSessionFeedback(app.store, session.id);
      const hidden = hiddenInSession(app.store, session.id);
      const listed = listSessionCandidates(app.store, session.id).map((candidate) => ({
        candidate,
        excerpt: currentExcerpt(app.store, app.paths.renderCache, candidate),
      }));
      const { pairs, folded } = candidatePairs(app.store, listed);
      const searched = await searchPlaces(
        app,
        listed.map(({ candidate }) => candidate),
      );
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
          const pair = pairs.get(id);
          return {
            id,
            genomeId,
            seed,
            intent,
            rejectReason,
            lint,
            genome,
            createdAt,
            vibeRevisionId: candidate.vibeRevisionId,
            operator: candidate.operator,
            operatorParams: candidate.operatorParams,
            parentIds: candidate.parentIds,
            pair: pair ?? null,
            excerpt,
            feedback,
            // A pair is hidden when either member is: rows from before a hide named both.
            hidden: [id, pair?.firstTryId, pair?.revisionId].some(
              (member) => member !== undefined && hidden.has(member),
            ),
            // Where the excerpt sits in the ranking (decision 0046).
            ranking: (render && places.get(render.id)) ?? null,
            // A search point's place in the table (decision 0054).
            search: searched.get(id) ?? null,
          };
        });
      return {
        candidates,
        ranking: ranking && {
          modelKey: ranking.modelKey,
          renderIds: ranking.excerpts.map(({ renderId }) => renderId),
          covariance: ranking.covariance,
        },
      };
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

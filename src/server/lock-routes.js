// The lock routes (decision 0035): lock a value of one of the vibe's candidates, list the vibe's
// live locks, and remove one. A lock takes its value from the candidate, so the owner names only
// the candidate and the path; the next candidates job writes it into every answer.
/** @import { Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { macrosMoving } from "../domain/macros-moving.js";
import { LOCK_FIELD, lockOn } from "../domain/validate-lock.js";
import { show } from "../engine/validation-error.js";
import { getCandidate, getGenome } from "./generation-store.js";
import { getLock, InsideLockedVoice, listLocks, removeLock, setLock } from "./lock-store.js";
import { fields, idParam, rowId } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

/** The body field naming the candidate a lock takes its value from. */
const CANDIDATE_ID = "candidateId";

/**
 * The genome of the candidate a body names, checked to be one of the vibe's.
 * @param {Store} store
 * @param {number} vibeId
 * @param {number} candidateId
 */
function candidateGenome(store, vibeId, candidateId) {
  const candidate = getCandidate(store, candidateId);
  if (!candidate) {
    throw new HttpError(
      400,
      `candidateId names candidate ${candidateId}, and there is no candidate ${candidateId}`,
    );
  }
  const row = candidate.genomeId === null ? undefined : getGenome(store, candidate.genomeId);
  if (!row) {
    throw new HttpError(
      400,
      `candidate ${candidateId} has no genome to lock a value from: it was rejected before it became one`,
    );
  }
  if (row.vibeId !== vibeId) {
    throw new HttpError(400, `candidate ${candidateId} is not a candidate of vibe ${vibeId}`);
  }
  return row.genome;
}

/** @type {Route[]} */
export const LOCK_ROUTES = [
  {
    method: "GET",
    path: "/api/vibes/:vibeId/locks",
    handle: ({ app, params }) => ({
      locks: listLocks(app.store, requireVibe(app.store, params).id),
    }),
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/locks",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), [CANDIDATE_ID, LOCK_FIELD.path]);
      const { path } = given;
      if (typeof path !== "string" || path === "") {
        throw new HttpError(400, `path must be a non-empty string, got ${show(path)}`);
      }
      const candidateId = rowId(given, CANDIDATE_ID);
      const genome = candidateGenome(app.store, vibe.id, candidateId);
      const taken = lockOn(genome, path);
      if (!taken.ok) throw new HttpError(400, taken.message);
      const { value, voiceType = null } = taken.lock;
      /** @type {ReturnType<typeof setLock>} */
      let set;
      try {
        set = setLock(app.store, { vibeId: vibe.id, candidateId, path, value, voiceType });
      } catch (error) {
        if (error instanceof InsideLockedVoice) throw new HttpError(409, error.message);
        throw error;
      }
      const { lock, removed } = set;
      // The macros still move a locked value (0006), so the lock control offers to lock them.
      return { lock, removed, macros: macrosMoving(path, genome) };
    },
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/locks/:lockId/remove",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const id = idParam(params, "lockId");
      fields(await body(), []);
      const lock = getLock(app.store, id);
      if (lock?.vibeId !== vibe.id) throw new HttpError(404, `vibe ${vibe.id} has no lock ${id}`);
      return removeLock(app.store, id);
    },
  },
];

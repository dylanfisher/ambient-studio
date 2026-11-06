// Session starts and stops, two rows per session, since an append-only row can't record its own
// end (decision 0021). A session's id is its start row's.
/** @import { Removable, Store } from "./store.js" */
import { insertRow, selectRow, TABLE } from "./store.js";

/**
 * @typedef {Removable & {
 *   id: number,
 *   vibeId: number,
 *   kind: "start" | "stop",
 *   sessionId: number | null,
 *   createdAt: number,
 * }} SessionEvent `sessionId` is null on a start and names the start on a stop
 */

const SESSION_EVENTS = {};

/**
 * @param {Store} store
 * @param {number} vibeId
 * @returns {SessionEvent}
 */
export function startSession(store, vibeId) {
  return insertRow(store, TABLE.sessionEvents, SESSION_EVENTS, { vibeId, kind: "start" });
}

/**
 * Throws when the session doesn't exist or has stopped already.
 * @param {Store} store
 * @param {number} sessionId the start row's id
 * @returns {SessionEvent}
 */
export function stopSession(store, sessionId) {
  /** @type {SessionEvent | undefined} */
  const start = selectRow(store, TABLE.sessionEvents, SESSION_EVENTS, sessionId);
  if (start?.kind !== "start") throw new Error(`there is no session ${sessionId}`);
  return insertRow(store, TABLE.sessionEvents, SESSION_EVENTS, {
    vibeId: start.vibeId,
    kind: "stop",
    sessionId,
  });
}

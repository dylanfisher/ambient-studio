// Candidates the owner hid on the session page (decision 0049). Each hide and each unhide is a
// row of its own, never changed, so the history stays: a candidate is hidden when its newest
// row says so. Hiding is not a rating; nothing but the session page and Quick A/B reads it.
/** @import { Removable, Store } from "./store.js" */
import { insertRow, selectRows, TABLE, transaction } from "./store.js";

/**
 * @typedef {Removable & {
 *   id: number,
 *   candidateId: number,
 *   hidden: boolean,
 *   createdAt: number,
 * }} Hide `hidden` false is an unhide
 */

/** The column that says whether a row hides or shows again, and the hide route's field for it. */
export const HIDDEN = "hidden";
const HIDES = { boolean: [HIDDEN] };

/**
 * Whether each candidate is hidden now, by id, for those with a row.
 * @param {Store} store
 * @param {readonly number[]} candidateIds
 * @returns {Map<number, boolean>}
 */
function currentState(store, candidateIds) {
  /** @type {Map<number, boolean>} */
  const state = new Map();
  for (const id of candidateIds) {
    const newest = listHides(store, id).at(-1);
    if (newest) state.set(id, newest.hidden);
  }
  return state;
}

/**
 * Hides or shows again each candidate, in one transaction, appending a row for each one whose
 * state changes. A candidate never hidden counts as shown. Throws, storing nothing, when a
 * candidate doesn't exist.
 * @param {Store} store
 * @param {readonly number[]} candidateIds
 * @param {boolean} hidden
 * @returns {Hide[]} the rows appended
 */
export function setHidden(store, candidateIds, hidden) {
  return transaction(store, () => {
    const ids = [...new Set(candidateIds)];
    const state = currentState(store, ids);
    return ids
      .filter((id) => (state.get(id) ?? false) !== hidden)
      .map(
        (candidateId) =>
          /** @type {Hide} */ (
            insertRow(store, TABLE.candidateHides, HIDES, { candidateId, hidden })
          ),
      );
  });
}

/**
 * Every hide and unhide of the candidate, oldest first.
 * @param {Store} store
 * @param {number} candidateId
 * @returns {Hide[]}
 */
export function listHides(store, candidateId) {
  return selectRows(store, TABLE.candidateHides, HIDES, { candidateId });
}

/**
 * The ids of the session's candidates that are hidden now.
 * @param {Store} store
 * @param {number} sessionId
 * @returns {Set<number>}
 */
export function hiddenInSession(store, sessionId) {
  const rows = store.db
    .prepare(
      `SELECT h.candidateId AS id, h.hidden FROM ${TABLE.candidateHides} h
         JOIN ${TABLE.candidates} c ON c.id = h.candidateId
        WHERE c.sessionId = ? AND h.removedAt IS NULL
          AND h.id = (SELECT max(id) FROM ${TABLE.candidateHides}
                       WHERE candidateId = h.candidateId AND removedAt IS NULL)`,
    )
    .all(sessionId);
  return new Set(rows.filter((row) => row.hidden === 1).map((row) => Number(row.id)));
}

// A track's developments of its sketches (decision 0079), append-only like the track's revisions
// (0021): developing a section again adds a row and keeps the earlier one. A development is the
// track's own; nothing that lists sketches, candidates or a brief's genomes reads this table.
/** @import { Removable, Store } from "./store.js" */
import { insertRow, selectRow, selectRows, TABLE } from "./store.js";

/**
 * @typedef {object} DevelopmentDraft
 * @property {number} trackId
 * @property {number} sketchId the sketch it develops
 * @property {string} text the owner's words for the section it was written from
 * @property {number} offset where the section started on the sketch's timeline
 * @property {number} seconds the length asked for, and its genome's duration
 * @property {number} genomeId its genome, in the `genomes` table under the track's vibe
 * @property {number} seed the sketch's candidate's
 * @property {number} generationId the answer it was taken from
 */

/** @typedef {DevelopmentDraft & Removable & { id: number, createdAt: number }} Development */

const DEVELOPMENTS = { json: [] };

/**
 * @param {Store} store
 * @param {DevelopmentDraft} draft
 * @returns {Development}
 */
export const addDevelopment = (store, draft) =>
  insertRow(store, TABLE.developments, DEVELOPMENTS, { ...draft });

/**
 * The development, removed or not.
 * @param {Store} store
 * @param {number} id
 * @returns {Development | undefined}
 */
export const getDevelopment = (store, id) => selectRow(store, TABLE.developments, DEVELOPMENTS, id);

/**
 * The track's developments not removed, oldest first.
 * @param {Store} store
 * @param {number} trackId
 * @returns {Development[]}
 */
export const listDevelopments = (store, trackId) =>
  selectRows(store, TABLE.developments, DEVELOPMENTS, { trackId });

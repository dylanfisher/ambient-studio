// Tracks, their revisions and their exports (decision 0061), append-only like a vibe and its
// revisions (0021): an edit of the arrangement appends a revision, the newest current, and
// removing a track marks it and keeps every row.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { Removable, Store } from "./store.js" */
import { insertRow, markRemoved, selectRow, selectRows, TABLE, transaction } from "./store.js";

/**
 * @typedef {object} TrackDraft
 * @property {number} vibeId
 * @property {string} name
 */

/** @typedef {TrackDraft & Removable & { id: number, createdAt: number }} Track */

/**
 * @typedef {object} TrackRevisionDraft
 * @property {Arrangement} arrangement checked by `validateArrangement` first
 * @property {string} note the owner's, or empty
 */

/**
 * @typedef {TrackRevisionDraft & Removable & { id: number, trackId: number, createdAt: number }}
 *   TrackRevision
 */

/**
 * @typedef {object} TrackExportDraft
 * @property {number} trackRevisionId
 * @property {ExportKind} kind
 * @property {string} folder relative to the data root's exports/
 * @property {string} manifestSha256
 */

/** @typedef {TrackExportDraft & Removable & { id: number, createdAt: number }} TrackExport */

/**
 * What an export writes: the mix (0062), or the mix with one stem per voice id beside it (0063).
 */
export const EXPORT_KIND = Object.freeze({ mix: "mix", stems: "stems" });

/** @typedef {typeof EXPORT_KIND[keyof typeof EXPORT_KIND]} ExportKind */

/** Why a track was marked removed: the owner removed it. */
export const TRACK_REMOVED = "removed";

/** The fields of a `TrackRevisionDraft`, by name. */
export const TRACK_REVISION_FIELD = Object.freeze({ arrangement: "arrangement", note: "note" });

const TRACKS = { json: [] };
const REVISIONS = { json: [TRACK_REVISION_FIELD.arrangement] };
const EXPORTS = { json: [] };

/**
 * A track with its first revision, noted `note`: empty for a hand-made track, or what a
 * proposal says of itself (0067).
 * @param {Store} store
 * @param {TrackDraft & { arrangement: Arrangement, note?: string }} draft
 * @returns {{ track: Track, revision: TrackRevision }}
 */
export function createTrack(store, { vibeId, name, arrangement, note = "" }) {
  return transaction(store, () => {
    /** @type {Track} */
    const track = insertRow(store, TABLE.tracks, TRACKS, { vibeId, name });
    return { track, revision: reviseTrack(store, track.id, { arrangement, note }) };
  });
}

/**
 * Appends a revision to a track; it becomes the track's current one.
 * @param {Store} store
 * @param {number} trackId
 * @param {TrackRevisionDraft} draft
 * @returns {TrackRevision}
 */
export function reviseTrack(store, trackId, { arrangement, note }) {
  return insertRow(store, TABLE.trackRevisions, REVISIONS, { trackId, arrangement, note });
}

/**
 * The track, removed or not.
 * @param {Store} store
 * @param {number} id
 * @returns {Track | undefined}
 */
export const getTrack = (store, id) => selectRow(store, TABLE.tracks, TRACKS, id);

/**
 * Every revision of a track, oldest first.
 * @param {Store} store
 * @param {number} trackId
 * @returns {TrackRevision[]}
 */
export const listTrackRevisions = (store, trackId) =>
  selectRows(store, TABLE.trackRevisions, REVISIONS, { trackId });

/**
 * The vibe's tracks not removed, oldest first, each with its newest revision.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {(Track & { revision: TrackRevision })[]}
 */
export function listTracks(store, vibeId) {
  /** @type {Track[]} */
  const tracks = selectRows(store, TABLE.tracks, TRACKS, { vibeId });
  return tracks.map((track) => {
    const revision = listTrackRevisions(store, track.id).at(-1);
    if (!revision) throw new Error(`track ${track.id} has no revision`);
    return { ...track, revision };
  });
}

/**
 * Marks a track removed by the owner; its revisions and exports stay as they are.
 * @param {Store} store
 * @param {number} id
 */
export const removeTrack = (store, id) => markRemoved(store, TABLE.tracks, id, TRACK_REMOVED);

/**
 * Logs an export written from a revision.
 * @param {Store} store
 * @param {TrackExportDraft} draft
 * @returns {TrackExport}
 */
export const addTrackExport = (store, draft) =>
  insertRow(store, TABLE.trackExports, EXPORTS, { ...draft });

/**
 * The exports written from a revision, oldest first.
 * @param {Store} store
 * @param {number} trackRevisionId
 * @returns {TrackExport[]}
 */
export const listTrackExports = (store, trackRevisionId) =>
  selectRows(store, TABLE.trackExports, EXPORTS, { trackRevisionId });

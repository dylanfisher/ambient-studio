// Reference files and the regions marked on them (decision 0050). Both are irreplaceable: a row
// is never changed, a removal marks it, and changing a region marks it replaced and adds its
// successor. Removing a file keeps its bytes in the references folder.
/** @import { RegionFields } from "../domain/reference-region.js" */
/** @import { Removable, Store } from "./store.js" */
import { insertRow, markRemoved, selectRow, selectRows, TABLE, transaction } from "./store.js";

/**
 * @typedef {object} ReferenceFileDraft
 * @property {string} sha256 of the file's bytes
 * @property {string} fileName the name the owner's file had, stored only as text
 * @property {string} format an `ACCEPTED_FORMATS` key
 * @property {string} file relative to the references folder, `<sha256>.<extension>`
 * @property {number} durationSeconds
 * @property {number} channels 1 or 2
 * @property {number} sampleRate the file's own, in Hz
 * @property {number} sizeBytes
 */

/** @typedef {ReferenceFileDraft & Removable & { id: number, createdAt: number }} ReferenceFile */

/**
 * @typedef {RegionFields & Removable & {
 *   id: number,
 *   referenceFileId: number,
 *   replacesId: number | null,
 *   createdAt: number,
 * }} Region `replacesId` names the region this one replaced
 */

/** Why a reference row was marked removed. */
export const REMOVED = Object.freeze({
  /** the owner removed it */
  removed: "removed",
  /** a changed copy of the region took its place */
  replaced: "replaced",
  /** the owner removed the file the region is on */
  fileRemoved: "file removed",
});

const PLAIN = {};

/**
 * Stores a reference file, or finds the live row with the same bytes. A second upload of the
 * same bytes changes nothing, so its file name is not kept.
 * @param {Store} store
 * @param {ReferenceFileDraft} draft
 * @returns {{ reference: ReferenceFile, added: boolean }}
 */
export function addReferenceFile(store, draft) {
  return transaction(store, () => {
    const [live] = selectRows(store, TABLE.referenceFiles, PLAIN, { sha256: draft.sha256 });
    if (live) return { reference: /** @type {ReferenceFile} */ (live), added: false };
    const reference = /** @type {ReferenceFile} */ (
      insertRow(store, TABLE.referenceFiles, PLAIN, { ...draft })
    );
    return { reference, added: true };
  });
}

/**
 * The live reference file with these bytes, if any.
 * @param {Store} store
 * @param {string} sha256
 * @returns {ReferenceFile | undefined}
 */
export const findReferenceFile = (store, sha256) =>
  /** @type {ReferenceFile | undefined} */ (
    selectRows(store, TABLE.referenceFiles, PLAIN, { sha256 })[0]
  );

/**
 * The row with `id`, removed or not.
 * @param {Store} store
 * @param {number} id
 * @returns {ReferenceFile | undefined}
 */
export const getReferenceFile = (store, id) => selectRow(store, TABLE.referenceFiles, PLAIN, id);

/**
 * The live reference files, oldest first.
 * @param {Store} store
 * @returns {ReferenceFile[]}
 */
export const listReferenceFiles = (store) => selectRows(store, TABLE.referenceFiles, PLAIN, {});

/**
 * Marks a file removed, and its live regions with it, in one transaction. Its bytes stay.
 * @param {Store} store
 * @param {number} id
 */
export function removeReferenceFile(store, id) {
  transaction(store, () => {
    for (const region of listRegions(store, id)) {
      markRemoved(store, TABLE.referenceRegions, region.id, REMOVED.fileRemoved);
    }
    markRemoved(store, TABLE.referenceFiles, id, REMOVED.removed);
  });
}

/**
 * @param {Store} store
 * @param {RegionFields & { referenceFileId: number }} draft
 * @returns {Region}
 */
export const addRegion = (store, draft) =>
  insertRow(store, TABLE.referenceRegions, PLAIN, { ...draft, replacesId: null });

/**
 * The row with `id`, removed or not.
 * @param {Store} store
 * @param {number} id
 * @returns {Region | undefined}
 */
export const getRegion = (store, id) => selectRow(store, TABLE.referenceRegions, PLAIN, id);

/**
 * A file's live regions, oldest first.
 * @param {Store} store
 * @param {number} referenceFileId
 * @returns {Region[]}
 */
export const listRegions = (store, referenceFileId) =>
  selectRows(store, TABLE.referenceRegions, PLAIN, { referenceFileId });

/**
 * Marks a live region replaced and adds its successor on the same file, in one transaction.
 * Throws when the region doesn't exist or was removed.
 * @param {Store} store
 * @param {number} id
 * @param {RegionFields} fields
 * @returns {Region} the successor
 */
export function replaceRegion(store, id, { startSeconds, endSeconds, label, note }) {
  return transaction(store, () => {
    const old = getRegion(store, id);
    if (!old) throw new Error(`there is no region ${id}`);
    if (old.removedAt !== null) throw new Error(`region ${id} was removed (${old.removedReason})`);
    markRemoved(store, TABLE.referenceRegions, id, REMOVED.replaced);
    return /** @type {Region} */ (
      insertRow(store, TABLE.referenceRegions, PLAIN, {
        referenceFileId: old.referenceFileId,
        startSeconds,
        endSeconds,
        label,
        note,
        replacesId: id,
      })
    );
  });
}

/**
 * @param {Store} store
 * @param {number} id
 */
export const removeRegion = (store, id) =>
  markRemoved(store, TABLE.referenceRegions, id, REMOVED.removed);

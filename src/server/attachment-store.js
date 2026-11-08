// What the owner attaches to a vibe beside its revisions (decision 0052): reference regions now,
// directions and axes later, one row each, append-only. Detaching marks the row; a region that
// is changed or removed is detached from every vibe in the same transaction, so a live
// attachment always names a live region.
/** @import { Removable, Store } from "./store.js" */
import { ATTACHMENT_KIND } from "../domain/attachment-kind.js";
import { insertRow, markRemoved, selectRow, selectRows, TABLE } from "./store.js";

/**
 * @typedef {object} AttachmentDraft
 * @property {number} vibeId
 * @property {string} kind an `ATTACHMENT_KIND` value
 * @property {number | null} regionId the region a reference names
 * @property {Record<string, unknown>} details what the kind needs besides the region; `{}` for a
 *   reference
 */

/** @typedef {AttachmentDraft & Removable & { id: number, createdAt: number }} Attachment */

const ATTACHMENTS = { json: ["details"] };

/**
 * What each kind's `details` may hold: a check returning the problem, or null when they are
 * right. 5g and 5h add their kinds' checks here.
 * @type {Readonly<Record<string, (details: Record<string, unknown>) => string | null>>}
 */
const DETAILS_CHECKS = Object.freeze({
  [ATTACHMENT_KIND.reference]: (details) =>
    Object.keys(details).length === 0 ? null : "a reference takes no details, {}",
});

/** Why an attachment was marked removed. */
export const DETACHED = Object.freeze({
  /** the owner detached it */
  owner: "detached",
  /** the owner changed its region, whose successor is a new region to attach */
  regionReplaced: "region replaced",
  /** the owner removed its region */
  regionRemoved: "region removed",
  /** the owner removed the recording its region is on */
  fileRemoved: "recording removed",
});

/**
 * Stores an attachment. Throws on a kind with no details check, and on details its check
 * refuses.
 * @param {Store} store
 * @param {AttachmentDraft} draft
 * @returns {Attachment}
 */
export function addAttachment(store, draft) {
  const check = DETAILS_CHECKS[draft.kind];
  if (!check) throw new Error(`there is no attachment kind ${JSON.stringify(draft.kind)}`);
  const problem = check(draft.details);
  if (problem !== null)
    throw new Error(`the ${draft.kind} attachment's details are wrong: ${problem}`);
  return insertRow(store, TABLE.vibeAttachments, ATTACHMENTS, { ...draft });
}

/**
 * The row with `id`, removed or not.
 * @param {Store} store
 * @param {number} id
 * @returns {Attachment | undefined}
 */
export const getAttachment = (store, id) =>
  selectRow(store, TABLE.vibeAttachments, ATTACHMENTS, id);

/**
 * The vibe's live attachments of `kind`, oldest first.
 * @param {Store} store
 * @param {number} vibeId
 * @param {string} kind
 * @returns {Attachment[]}
 */
export const listAttachments = (store, vibeId, kind) =>
  selectRows(store, TABLE.vibeAttachments, ATTACHMENTS, { vibeId, kind });

/**
 * Marks a live attachment detached by the owner. Throws when it doesn't exist or was removed.
 * @param {Store} store
 * @param {number} id
 */
export const detachAttachment = (store, id) =>
  markRemoved(store, TABLE.vibeAttachments, id, DETACHED.owner);

/**
 * Marks every live attachment naming the region removed, for `reason`. The caller holds the
 * transaction that changes the region.
 * @param {Store} store
 * @param {number} regionId
 * @param {string} reason a `DETACHED` value
 */
export function detachRegion(store, regionId, reason) {
  for (const row of selectRows(store, TABLE.vibeAttachments, ATTACHMENTS, { regionId })) {
    markRemoved(store, TABLE.vibeAttachments, /** @type {Attachment} */ (row).id, reason);
  }
}

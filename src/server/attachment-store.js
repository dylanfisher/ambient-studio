// What the owner attaches to a vibe beside its revisions (decision 0052): reference regions,
// directions (0056) and the map's axes (0057), one row each, append-only. Detaching marks the
// row; a region that is changed or removed is detached from every vibe in the same transaction,
// so a live attachment always names a live region.
/** @import { Removable, Store } from "./store.js" */
import {
  ATTACHMENT_KIND,
  AXIS_DETAILS,
  AXIS_KEYS,
  AXIS_SOURCE,
  DIRECTION_END_CHARS,
  DIRECTION_ENDS,
} from "../domain/attachment-kind.js";
import { NOT_ONE_LINE } from "../domain/explore-direction.js";
import { TARGET_FEATURES } from "../domain/target-schema.js";
import { MACROS } from "../engine/genome-schema.js";
import { insertRow, markRemoved, selectRow, selectRows, TABLE } from "./store.js";

/**
 * @typedef {object} AttachmentDraft
 * @property {number} vibeId
 * @property {string} kind an `ATTACHMENT_KIND` value
 * @property {number | null} regionId the region a reference, or an axis on a region, names;
 *   null otherwise
 * @property {Record<string, unknown>} details what the kind needs besides the region; `{}` for a
 *   reference, `{near, far}` for a direction, an axis's source, ends and bins (0057)
 */

/** @typedef {AttachmentDraft & Removable & { id: number, createdAt: number }} Attachment */

const ATTACHMENTS = { json: ["details"] };

/**
 * A direction end's problem, or null when it is one line of text within the limit.
 * @param {unknown} end
 * @param {string} which its name, from `DIRECTION_ENDS`
 */
function endProblem(end, which) {
  if (typeof end !== "string") return null;
  if (end.trim() === "") return `its ${which} end must hold some text`;
  if (NOT_ONE_LINE.test(end))
    return `its ${which} end must be one line, with no control characters`;
  if (end.length > DIRECTION_END_CHARS) {
    return `its ${which} end must be at most ${DIRECTION_END_CHARS} characters`;
  }
  return null;
}

/** The fewest and most bins one axis may cut its ends into. */
const AXIS_BIN_RANGE = Object.freeze({ least: 2, most: 16 });

/** @param {unknown} value */
const positiveId = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;

/**
 * An axis's problem, or null when its details are right (decision 0057): its source, what names
 * it, `ends` as `[low, high]` with either null for the default, and `bins`. An axis on a region
 * names the region in the row's `regionId`.
 * @param {Record<string, unknown>} details
 * @param {number | null} regionId
 * @returns {string | null}
 */
function axisProblem(details, regionId) {
  const { source, name, directionId, ends, bins } = details;
  // Own keys only, so a prototype name such as "constructor" is no source or name.
  const extra =
    typeof source === "string" && Object.hasOwn(AXIS_KEYS, source) ? AXIS_KEYS[source] : undefined;
  if (extra === undefined) return "an axis's source is feature, macro, direction or region";
  const keys = [AXIS_DETAILS.source, ...extra, AXIS_DETAILS.ends, AXIS_DETAILS.bins];
  if (Object.keys(details).length !== keys.length || !keys.every((key) => key in details)) {
    return `an axis on a ${source}'s details are {${keys.join(", ")}}`;
  }
  if (source === AXIS_SOURCE.region && !positiveId(regionId)) return "an axis on a region names it";
  if (source !== AXIS_SOURCE.region && regionId !== null) {
    return "an axis names a region only on a region";
  }
  const named = (/** @type {object} */ table) =>
    typeof name === "string" && Object.hasOwn(table, name);
  if (source === AXIS_SOURCE.feature && !named(TARGET_FEATURES)) {
    return `${JSON.stringify(name)} is not a feature a range may name`;
  }
  if (source === AXIS_SOURCE.macro && !named(MACROS)) {
    return `${JSON.stringify(name)} is not a macro`;
  }
  if (source === AXIS_SOURCE.direction && !positiveId(directionId)) {
    return "an axis on a direction names a direction attachment's id";
  }
  if (
    !Array.isArray(ends) ||
    ends.length !== 2 ||
    !ends.every((end) => end === null || Number.isFinite(end))
  ) {
    return "its ends are [low, high], each a number or null for the default";
  }
  const [low, high] = ends;
  if (low !== null && high !== null && low >= high) {
    return "its low end must be under its high end";
  }
  const { least, most } = AXIS_BIN_RANGE;
  if (!Number.isInteger(bins) || Number(bins) < least || Number(bins) > most) {
    return `its bins are a whole number from ${least} to ${most}`;
  }
  return null;
}

/**
 * What each kind's `details` and region may be: a check returning the problem, or null when
 * they are right.
 * @type {Readonly<Record<string, (details: Record<string, unknown>, regionId: number | null) => string | null>>}
 */
const DETAILS_CHECKS = Object.freeze({
  [ATTACHMENT_KIND.reference]: (details) =>
    Object.keys(details).length === 0 ? null : "a reference takes no details, {}",
  // The near end is null when it is the mean of the vibe's excerpts (decision 0056).
  [ATTACHMENT_KIND.direction]: (details, regionId) => {
    if (regionId !== null) return "a direction names no region";
    const [nearKey, farKey] = DIRECTION_ENDS;
    const keys = Object.keys(details);
    if (keys.length !== DIRECTION_ENDS.length || !DIRECTION_ENDS.every((key) => key in details)) {
      return `a direction's details are {${DIRECTION_ENDS.join(", ")}}`;
    }
    const { [nearKey]: near, [farKey]: far } = details;
    if (near !== null && typeof near !== "string") return "its near end must be text or null";
    if (typeof far !== "string") return "its far end must be text";
    const problem = endProblem(far, farKey) ?? endProblem(near, nearKey);
    if (problem !== null) return problem;
    return near !== null && near.trim() === far.trim() ? "its two ends are the same text" : null;
  },
  [ATTACHMENT_KIND.axis]: axisProblem,
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
  /** the owner chose the map's axes again, which replaces every live axis (0057) */
  axesReplaced: "axes replaced",
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
  const problem = check(draft.details, draft.regionId);
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

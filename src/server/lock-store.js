// A vibe's locks (decision 0035): one live lock per path, kept until the owner removes it. A
// new lock on a live path replaces it, a whole voice covers the live locks inside it, and a path
// inside a voice locked whole is refused, so two live locks never hold one value.
/** @import { Lock } from "../domain/validate-lock.js" */
/** @import { Removable, Store } from "./store.js" */
import { LOCK_KIND, lockCovers, parseLockPath } from "../domain/lock-path.js";
import { LOCK_FIELD } from "../domain/validate-lock.js";
import { insertRow, markRemoved, selectRow, selectRows, TABLE, transaction } from "./store.js";

/**
 * @typedef {object} LockDraft
 * @property {number} vibeId
 * @property {number} candidateId the candidate the value was taken from
 * @property {string} path
 * @property {unknown} value canonical JSON, checked by `validateLock` before it is stored
 * @property {string | null} voiceType set exactly when the path is a voice's parameter
 */

/** @typedef {LockDraft & Removable & { id: number, createdAt: number }} LockRow */

const LOCKS = { json: [LOCK_FIELD.value] };

/** Why a lock was marked removed. */
const REMOVAL = Object.freeze({
  /** the owner removed it */
  unlocked: "unlocked",
  /** a later lock on the same path took its place */
  replaced: "replaced",
  /** a later lock on its whole voice holds it */
  covered: "covered",
});

/** A lock refused because the path is inside a voice the vibe has locked whole. */
export class InsideLockedVoice extends Error {
  /**
   * @param {string} path
   * @param {string} voicePath
   */
  constructor(path, voicePath) {
    super(`${path} is inside ${voicePath}, which is locked whole; unlock the voice first`);
  }
}

/**
 * The vibe's live lock on a whole voice that holds `path`, if any.
 * @param {readonly LockRow[]} live
 * @param {string} path
 * @returns {LockRow | undefined}
 */
function lockedVoiceHolding(live, path) {
  return live.find(
    (row) =>
      row.path !== path &&
      parseLockPath(row.path)?.kind === LOCK_KIND.voice &&
      lockCovers(row.path, path),
  );
}

/**
 * Stores a lock, marking the live lock on its path replaced and, for a whole voice, the live
 * locks inside it covered, in one transaction. Throws `InsideLockedVoice` when the path is
 * inside a voice the vibe has locked whole.
 * @param {Store} store
 * @param {LockDraft} draft
 * @returns {{ lock: LockRow, removed: LockRow[] }} the new row, and the rows it marked removed
 */
export function setLock(store, draft) {
  return transaction(store, () => {
    const live = listLocks(store, draft.vibeId);
    const voice = lockedVoiceHolding(live, draft.path);
    if (voice) throw new InsideLockedVoice(draft.path, voice.path);
    const removed = [];
    for (const row of live) {
      const reason =
        row.path === draft.path
          ? REMOVAL.replaced
          : lockCovers(draft.path, row.path)
            ? REMOVAL.covered
            : null;
      if (reason === null) continue;
      markRemoved(store, TABLE.locks, row.id, reason);
      removed.push(/** @type {LockRow} */ (getLock(store, row.id)));
    }
    /** @type {LockRow} */
    const lock = insertRow(store, TABLE.locks, LOCKS, { ...draft });
    return { lock, removed };
  });
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {LockRow | undefined}
 */
export function getLock(store, id) {
  return selectRow(store, TABLE.locks, LOCKS, id);
}

/**
 * The vibe's live locks, oldest first.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {LockRow[]}
 */
export function listLocks(store, vibeId) {
  return selectRows(store, TABLE.locks, LOCKS, { vibeId });
}

/**
 * The vibe's live locks in the shape the prompt and `applyLocks` read.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {Lock[]}
 */
export function locksInForce(store, vibeId) {
  return listLocks(store, vibeId).map(({ path, value, voiceType }) => ({
    path,
    value,
    ...(voiceType !== null && { voiceType }),
  }));
}

/**
 * Marks the lock removed as unlocked; one already removed is left as it is.
 * @param {Store} store
 * @param {number} id
 * @returns {LockRow}
 */
export function removeLock(store, id) {
  const row = getLock(store, id);
  if (!row) throw new Error(`there is no lock ${id}`);
  if (row.removedAt !== null) return row;
  markRemoved(store, TABLE.locks, id, REMOVAL.unlocked);
  return /** @type {LockRow} */ (getLock(store, id));
}

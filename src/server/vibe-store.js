// Vibes, their revisions and their notes (decision 0021).
/** @import { Removable, Store } from "./store.js" */
import { insertRow, selectRow, selectRows, TABLE, transaction } from "./store.js";

/**
 * What the owner edits: every edit appends a revision.
 * @typedef {object} VibeDraft
 * @property {string} name
 * @property {string} brief
 * @property {unknown} constraints 2b's constraint set, checked by the caller
 * @property {unknown} softTargets
 */

/**
 * @typedef {VibeDraft & Removable & { id: number, vibeId: number, createdAt: number }}
 *   VibeRevision
 */

/**
 * A vibe with its newest revision.
 * @typedef {Removable & { id: number, createdAt: number, revision: VibeRevision }} Vibe
 */

/**
 * @typedef {object} NoteDraft
 * @property {number} vibeId
 * @property {string} text
 */

/** @typedef {NoteDraft & Removable & { id: number, createdAt: number }} Note */

const VIBES = { json: [] };
const REVISIONS = { json: ["constraints", "softTargets"] };
const NOTES = { json: [] };

/**
 * @param {Store} store
 * @param {VibeDraft} draft
 * @returns {Vibe}
 */
export function createVibe(store, draft) {
  return transaction(store, () => {
    /** @type {Omit<Vibe, "revision">} */
    const vibe = insertRow(store, TABLE.vibes, VIBES, {});
    return { ...vibe, revision: reviseVibe(store, vibe.id, draft) };
  });
}

/**
 * Appends a revision to a vibe; it becomes the vibe's current one.
 * @param {Store} store
 * @param {number} vibeId
 * @param {VibeDraft} draft
 * @returns {VibeRevision}
 */
export function reviseVibe(store, vibeId, { name, brief, constraints, softTargets }) {
  return insertRow(store, TABLE.vibeRevisions, REVISIONS, {
    vibeId,
    name,
    brief,
    constraints,
    softTargets,
  });
}

/**
 * Every revision of a vibe, oldest first.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {VibeRevision[]}
 */
export function listRevisions(store, vibeId) {
  return /** @type {VibeRevision[]} */ (
    selectRows(store, TABLE.vibeRevisions, REVISIONS, { vibeId })
  );
}

/**
 * @param {Store} store
 * @param {Omit<Vibe, "revision">} vibe
 * @returns {Vibe}
 */
function withRevision(store, vibe) {
  const revision = listRevisions(store, vibe.id).at(-1);
  if (!revision) throw new Error(`vibe ${vibe.id} has no revision`);
  return { ...vibe, revision };
}

/**
 * The vibe, removed or not, or undefined when there is none.
 * @param {Store} store
 * @param {number} id
 * @returns {Vibe | undefined}
 */
export function getVibe(store, id) {
  /** @type {Omit<Vibe, "revision"> | undefined} */
  const vibe = selectRow(store, TABLE.vibes, VIBES, id);
  return vibe && withRevision(store, vibe);
}

/**
 * The vibes not removed, oldest first.
 * @param {Store} store
 * @returns {Vibe[]}
 */
export function listVibes(store) {
  /** @type {Omit<Vibe, "revision">[]} */
  const vibes = selectRows(store, TABLE.vibes, VIBES, {});
  return vibes.map((vibe) => withRevision(store, vibe));
}

/**
 * @param {Store} store
 * @param {NoteDraft} draft
 * @returns {Note}
 */
export function addNote(store, { vibeId, text }) {
  return insertRow(store, TABLE.notes, NOTES, { vibeId, text });
}

/**
 * A vibe's notes not removed, oldest first.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {Note[]}
 */
export function listNotes(store, vibeId) {
  return /** @type {Note[]} */ (selectRows(store, TABLE.notes, NOTES, { vibeId }));
}

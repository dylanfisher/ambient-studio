// The derived render cache (decision 0021). A row is found only by its whole key, the caller's
// `producer` included, and a row for the same window under another target or producer is
// replaced, never returned.
/** @import { Store } from "./store.js" */
import { decode, insertRow, TABLE, transaction } from "./store.js";

/**
 * The excerpt a render is of; one row per window.
 * @typedef {object} RenderWindow
 * @property {number} genomeId
 * @property {number} seed
 * @property {number} offset timeline seconds
 * @property {number} duration seconds
 */

/**
 * @typedef {RenderWindow & RenderTerms} RenderKey
 */

/**
 * @typedef {object} RenderTerms
 * @property {number} target LUFS
 * @property {string} producer opaque here; 2h composes it from the engine version and the
 *   feature extractor's source
 */

/**
 * @typedef {RenderKey & { file: string, features: unknown, checks: unknown }} RenderDraft
 *   `file` relative to the render-cache folder
 */

/** @typedef {RenderDraft & { id: number, createdAt: number }} Render */

const RENDERS = { json: ["features", "checks"] };

/**
 * @param {Store} store
 * @param {RenderWindow} window
 * @returns {Render | undefined}
 */
function renderFor(store, { genomeId, seed, offset, duration }) {
  const row = store.db
    .prepare(
      "SELECT * FROM renders WHERE genomeId = ? AND seed = ? AND offset = ? AND duration = ?",
    )
    .get(genomeId, seed, offset, duration);
  return row && decode(RENDERS, row);
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Render | undefined}
 */
export function getRender(store, id) {
  const row = store.db.prepare("SELECT * FROM renders WHERE id = ?").get(id);
  return row && decode(RENDERS, row);
}

/**
 * The cached render for `key`, or undefined when there is none or the cached one was made under
 * another target or producer.
 * @param {Store} store
 * @param {RenderKey} key
 * @returns {Render | undefined}
 */
export function findRender(store, key) {
  const render = renderFor(store, key);
  return render?.target === key.target && render.producer === key.producer ? render : undefined;
}

/**
 * Stores a render, replacing any row for the same window. Returns the replaced row too, so the
 * caller can delete its file.
 * @param {Store} store
 * @param {RenderDraft} draft
 * @returns {{ render: Render, replaced: Render | undefined }}
 */
export function putRender(store, draft) {
  return transaction(store, () => {
    const replaced = renderFor(store, draft);
    if (replaced) store.db.prepare("DELETE FROM renders WHERE id = ?").run(replaced.id);
    /** @type {Render} */
    const render = insertRow(store, TABLE.renders, RENDERS, { ...draft });
    return { render, replaced };
  });
}

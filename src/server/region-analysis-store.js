// The derived analysis of a reference region (decision 0051): one row per region and loudness
// target. A row is found only under the caller's features producer, and one under another is
// replaced, never returned, as `renders` rows are. The embedding sits on the row under its own
// producer, set once the features are stored, so a sidecar failure keeps the features.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { Store } from "./store.js" */
import { decode, insertRow, TABLE, transaction } from "./store.js";

/**
 * One window's measurements.
 * @typedef {object} WindowAnalysis
 * @property {number} startSeconds into the region
 * @property {number} seconds the window's length
 * @property {Features} features `heard` is null when normalize couldn't take the window
 * @property {string | null} notHeard normalize's message when it couldn't, else null
 */

/**
 * @typedef {object} RegionAnalysisKey
 * @property {number} regionId
 * @property {number} target LUFS each window was normalized to
 * @property {string} producer the features' producer
 */

/**
 * @typedef {RegionAnalysisKey & {
 *   id: number,
 *   windows: WindowAnalysis[],
 *   embeddingProducer: string | null,
 *   embedding: Uint8Array | null,
 *   createdAt: number,
 * }} RegionAnalysis `embedding` is little-endian float32, null until it is made
 */

const ANALYSES = { json: ["windows"] };

/**
 * @param {Store} store
 * @param {number} regionId
 * @param {number} target
 * @returns {RegionAnalysis | undefined}
 */
function analysisFor(store, regionId, target) {
  const row = store.db
    .prepare("SELECT * FROM region_analyses WHERE regionId = ? AND target = ?")
    .get(regionId, target);
  return row && decode(ANALYSES, row);
}

/**
 * The region's analysis at `target` under `producer`, or undefined when there is none or it
 * was made under another producer.
 * @param {Store} store
 * @param {RegionAnalysisKey} key
 * @returns {RegionAnalysis | undefined}
 */
export function findRegionAnalysis(store, { regionId, target, producer }) {
  const found = analysisFor(store, regionId, target);
  return found?.producer === producer ? found : undefined;
}

/**
 * Stores a region's window features with no embedding, replacing any row for the same region
 * and target.
 * @param {Store} store
 * @param {RegionAnalysisKey & { windows: WindowAnalysis[] }} draft
 * @returns {RegionAnalysis}
 */
export function putRegionFeatures(store, draft) {
  return transaction(store, () => {
    store.db
      .prepare("DELETE FROM region_analyses WHERE regionId = ? AND target = ?")
      .run(draft.regionId, draft.target);
    /** @type {RegionAnalysis} */
    const row = insertRow(store, TABLE.regionAnalyses, ANALYSES, {
      ...draft,
      embeddingProducer: null,
      embedding: null,
    });
    return row;
  });
}

/**
 * Sets an analysis's embedding, replacing one made under another producer.
 * @param {Store} store
 * @param {number} id
 * @param {{ embeddingProducer: string, embedding: Uint8Array }} embedding
 * @returns {RegionAnalysis}
 */
export function putRegionEmbedding(store, id, { embeddingProducer, embedding }) {
  const row = store.db
    .prepare(
      "UPDATE region_analyses SET embeddingProducer = ?, embedding = ? WHERE id = ? RETURNING *",
    )
    .get(embeddingProducer, embedding, id);
  if (!row) throw new Error(`there is no region analysis ${id}`);
  return decode(ANALYSES, row);
}

// The derived CLAP embeddings (decision 0042): one row per rated audio or render. A row is found
// only under the caller's producer; a row under another producer is replaced or dropped, never
// returned.
/** @import { Store } from "./store.js" */
import { decode, insertRow, TABLE, transaction } from "./store.js";

/**
 * What an embedding is of: exactly one of the two is set.
 * @typedef {{ ratedAudioId: number, renderId: null } | { ratedAudioId: null, renderId: number }}
 *   EmbeddingSource
 */

/**
 * @typedef {EmbeddingSource & { producer: string, vector: Uint8Array }} EmbeddingDraft
 *   `vector` is the embedding as little-endian float32, the bytes the sidecar wrote
 */

/** @typedef {EmbeddingDraft & { id: number, createdAt: number }} Embedding */

const EMBEDDINGS = {};

/**
 * @param {Store} store
 * @param {EmbeddingSource} source
 * @returns {Embedding | undefined}
 */
function embeddingOf(store, { ratedAudioId, renderId }) {
  const row =
    ratedAudioId === null
      ? store.db.prepare("SELECT * FROM embeddings WHERE renderId = ?").get(renderId)
      : store.db.prepare("SELECT * FROM embeddings WHERE ratedAudioId = ?").get(ratedAudioId);
  return row && decode(EMBEDDINGS, row);
}

/**
 * The source's embedding under `producer`, or undefined when it has none or one made under
 * another producer.
 * @param {Store} store
 * @param {EmbeddingSource} source
 * @param {string} producer
 * @returns {Embedding | undefined}
 */
export function findEmbedding(store, source, producer) {
  const found = embeddingOf(store, source);
  return found?.producer === producer ? found : undefined;
}

/**
 * Stores an embedding, replacing any row for the same source.
 * @param {Store} store
 * @param {EmbeddingDraft} draft
 * @returns {Embedding}
 */
export function putEmbedding(store, draft) {
  return transaction(store, () => {
    const replaced = embeddingOf(store, draft);
    if (replaced) store.db.prepare("DELETE FROM embeddings WHERE id = ?").run(replaced.id);
    /** @type {Embedding} */
    const embedding = insertRow(store, TABLE.embeddings, EMBEDDINGS, { ...draft });
    return embedding;
  });
}

/**
 * Deletes every embedding made under another producer, and returns how many it deleted.
 * @param {Store} store
 * @param {string} producer
 * @returns {number}
 */
export function dropOtherEmbeddings(store, producer) {
  const { changes } = store.db.prepare("DELETE FROM embeddings WHERE producer <> ?").run(producer);
  return Number(changes);
}

/**
 * A stored vector's floats.
 * @param {Uint8Array} bytes little-endian float32, as the sidecar writes them
 * @returns {Float32Array}
 */
export function vectorFloats(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floats = new Float32Array(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < floats.length; i++)
    floats[i] = view.getFloat32(i * Float32Array.BYTES_PER_ELEMENT, true);
  return floats;
}

/**
 * The embeddings under `producer` of the genome's rated audio that isn't removed, oldest first.
 * @param {Store} store
 * @param {number} genomeId
 * @param {string} producer
 * @returns {Float32Array[]}
 */
export function ratedAudioEmbeddings(store, genomeId, producer) {
  const rows = store.db
    .prepare(
      `SELECT e.vector FROM embeddings e JOIN ${TABLE.ratedAudio} r ON r.id = e.ratedAudioId
        WHERE r.genomeId = ? AND r.removedAt IS NULL AND e.producer = ?
        ORDER BY r.id`,
    )
    .all(genomeId, producer);
  return rows.map((row) => vectorFloats(/** @type {Uint8Array} */ (row.vector)));
}

/**
 * The embeddings under `producer` of the vibe's excerpts: every render of one of its genomes as
 * an excerpt, at `target` under `renderProducer`, in render id order. A direction's scale and its
 * default near end are read over these (decision 0056).
 * @param {Store} store
 * @param {{ vibeId: number, target: number, duration: number, renderProducer: string,
 *   producer: string }} key
 * @returns {{ renderId: number, vector: Float32Array }[]}
 */
export function vibeExcerptEmbeddings(
  store,
  { vibeId, target, duration, renderProducer, producer },
) {
  const rows = store.db
    .prepare(
      `SELECT r.id AS renderId, e.vector FROM ${TABLE.renders} r
        JOIN ${TABLE.genomes} g ON g.id = r.genomeId
        JOIN ${TABLE.embeddings} e ON e.renderId = r.id
        WHERE g.vibeId = ? AND r.target = ? AND r.duration = ? AND r.producer = ?
          AND e.producer = ?
        ORDER BY r.id`,
    )
    .all(vibeId, target, duration, renderProducer, producer);
  return rows.map((row) => ({
    renderId: Number(row.renderId),
    vector: vectorFloats(/** @type {Uint8Array} */ (row.vector)),
  }));
}

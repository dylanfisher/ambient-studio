// Embeds an audio file through the sidecar's CLAP methods (decision 0042) and stores the vector.
// The sidecar writes each vector to a file in a temp folder under the data root, since arrays
// pass as file paths (0041), and the store keeps its bytes.
/** @import { EmbeddingSource, Embedding } from "./embedding-store.js" */
/** @import { App } from "./routing.js" */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { putEmbedding } from "./embedding-store.js";

/** Bytes per float32 the sidecar writes. */
const FLOAT_BYTES = 4;

/**
 * The checkpoint the sidecar embeds with, ready to use.
 * @typedef {object} Embedder
 * @property {string} checkpointCache the config's folder
 * @property {string} producer every embedding row's key
 * @property {number} dimension floats per vector
 */

/**
 * Why nothing is embedded when the config names no checkpoint folder.
 * @type {string}
 */
export const NO_CHECKPOINT_CACHE =
  "the config's sidecar.checkpointCache is null, so excerpts aren't embedded; set it to a folder for the CLAP checkpoint";

/**
 * The sidecar's embedder, or the reason there is none to use: the config names no folder, or
 * the checkpoint isn't in it and `fetch` is false. With `fetch`, the sidecar downloads the
 * checkpoint first when it is missing.
 * @param {App} app
 * @param {{ fetch: boolean, signal: AbortSignal }} options
 * @returns {Promise<Embedder | string>} the embedder, or why there is none
 */
export async function readEmbedder(app, { fetch, signal }) {
  const checkpointCache = app.config.sidecar.checkpointCache;
  if (checkpointCache === null) return NO_CHECKPOINT_CACHE;
  const { producer, dimension, ready } = await app.sidecar.request(
    "embedder",
    { checkpointCache, fetch },
    { signal },
  );
  if (!ready) {
    if (fetch)
      throw new Error(
        `the sidecar fetched the CLAP checkpoint, but ${checkpointCache} doesn't hold it`,
      );
    return `the CLAP checkpoint isn't in ${checkpointCache} yet, so excerpts aren't embedded; start the embed job to download it`;
  }
  if (!Number.isSafeInteger(dimension) || /** @type {number} */ (dimension) < 1) {
    throw new Error(`the sidecar's embedder has dimension ${dimension}`);
  }
  return {
    checkpointCache,
    producer: /** @type {string} */ (producer),
    dimension: /** @type {number} */ (dimension),
  };
}

/**
 * Embeds the audio `file` and stores it as `source`'s embedding, replacing any row it had.
 * A failure names the file.
 * @param {App} app
 * @param {Embedder} embedder
 * @param {EmbeddingSource} source
 * @param {string} file absolute
 * @param {AbortSignal} signal
 * @returns {Promise<Embedding>}
 */
export async function embedAudio(app, embedder, source, file, signal) {
  const temp = await mkdtemp(join(app.config.dataRoot, ".embed-"));
  try {
    const out = join(temp, "vector.f32");
    const params = { checkpointCache: embedder.checkpointCache, audio: file, out };
    try {
      await app.sidecar.request("embed_audio", params, { signal });
    } catch (error) {
      throw new Error(`embedding ${file} failed: ${/** @type {Error} */ (error).message}`, {
        cause: error,
      });
    }
    const bytes = await readFile(out);
    if (bytes.length !== embedder.dimension * FLOAT_BYTES) {
      throw new Error(
        `the sidecar wrote ${bytes.length} bytes for ${file}, not ${embedder.dimension} floats`,
      );
    }
    const vector = new Uint8Array(bytes);
    return putEmbedding(app.store, { ...source, producer: embedder.producer, vector });
  } finally {
    await rm(temp, { recursive: true });
  }
}

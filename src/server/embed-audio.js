// Embeds an audio file or a text through the sidecar's CLAP methods (decision 0042). The sidecar
// writes each vector to a file in a temp folder under the data root, since arrays pass as file
// paths (0041); the store keeps an audio file's bytes, and a text's go to a file cache.
/** @import { EmbeddingSource, Embedding } from "./embedding-store.js" */
/** @import { App } from "./routing.js" */
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { putEmbedding, vectorFloats } from "./embedding-store.js";
import { sha256Hex } from "./sha256-hex.js";

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
 * Asks the sidecar for one embedding, `method` with `params` and an `out` file in a temp folder
 * under the data root, and hands its bytes to `keep` before the folder is removed. A failure
 * names `what`.
 * @template T
 * @param {App} app
 * @param {Embedder} embedder
 * @param {{ method: "embed_audio" | "embed_text", params: Record<string, unknown>,
 *   what: string, signal: AbortSignal }} request
 * @param {(vector: Uint8Array, out: string) => Promise<T> | T} keep
 * @returns {Promise<T>}
 */
async function requestVector(app, embedder, { method, params, what, signal }, keep) {
  const temp = await mkdtemp(join(app.config.dataRoot, ".embed-"));
  try {
    const out = join(temp, "vector.f32");
    try {
      await app.sidecar.request(
        method,
        { checkpointCache: embedder.checkpointCache, ...params, out },
        { signal },
      );
    } catch (error) {
      throw new Error(`embedding ${what} failed: ${/** @type {Error} */ (error).message}`, {
        cause: error,
      });
    }
    const bytes = await readFile(out);
    if (bytes.length !== embedder.dimension * FLOAT_BYTES) {
      throw new Error(
        `the sidecar wrote ${bytes.length} bytes for ${what}, not ${embedder.dimension} floats`,
      );
    }
    return await keep(new Uint8Array(bytes), out);
  } finally {
    await rm(temp, { recursive: true });
  }
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
export function embedAudio(app, embedder, source, file, signal) {
  const request = { method: /** @type {const} */ ("embed_audio"), params: { audio: file } };
  return requestVector(app, embedder, { ...request, what: file, signal }, (vector) =>
    putEmbedding(app.store, { ...source, producer: embedder.producer, vector }),
  );
}

/**
 * The text's embedding under the embedder's producer: from the cache in `paths.textEmbeddings`
 * when it holds it, and otherwise from the sidecar, which then fills the cache. A cached file of
 * the wrong size is embedded again, as other derived data is rebuilt. A sidecar failure names
 * `what`.
 * @param {App} app
 * @param {Embedder} embedder
 * @param {string} text
 * @param {string} what names the text in an error
 * @param {AbortSignal} signal
 * @returns {Promise<Float32Array>}
 */
export async function embedText(app, embedder, text, what, signal) {
  const folder = app.paths.textEmbeddings;
  const file = join(folder, `${sha256Hex(`${embedder.producer}\n${text}`)}.f32`);
  const cached = await readFile(file).catch((/** @type {NodeJS.ErrnoException} */ error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (cached?.length === embedder.dimension * FLOAT_BYTES) {
    return vectorFloats(new Uint8Array(cached));
  }
  const request = { method: /** @type {const} */ ("embed_text"), params: { text } };
  return requestVector(app, embedder, { ...request, what, signal }, async (vector, out) => {
    await mkdir(folder, { recursive: true });
    await rename(out, file);
    return vectorFloats(vector);
  });
}

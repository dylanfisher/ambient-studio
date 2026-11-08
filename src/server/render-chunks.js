// A window of a genome rendered as chunks (decision 0062), each its own `renderOffline` with its
// own pre-roll, so a 15-minute window never holds more than one chunk's context. Chunks match
// one render of the window within 0007's tolerance; their split, from `chunkWindows`, fixes the
// exact samples.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { ChunkWindow } from "../engine/chunk-windows.js" */
/** @import { RenderOptions } from "../engine/render.js" */
import { CHUNK_SECONDS, chunkWindows } from "../engine/chunk-windows.js";
import { renderOffline } from "./render-offline.js";

/**
 * @typedef {object} ChunkOptions
 * @property {number} [chunkSeconds] `CHUNK_SECONDS` when omitted; tests pass seconds
 * @property {number} [from] the window's first frame wanted; chunks wholly before it are skipped
 * @property {number} [to] the frame after the last wanted; chunks wholly after it are skipped
 * @property {AbortSignal} [signal] checked before each chunk
 * @property {(number: number, count: number) => void} [starting] called before each chunk
 *   renders, with its number among the chunks wanted, from 1
 */

/** @typedef {ChunkWindow & { channels: Float32Array[] }} RenderedChunk */

/**
 * The chunks of `options`' window that a span of it needs, rendered in order.
 * @param {Genome} genome
 * @param {RenderOptions} options the window, seed, samples and voices, as `renderOffline` takes
 *   them; the window is split into chunks
 * @param {ChunkOptions} [chunking]
 * @returns {AsyncGenerator<RenderedChunk>}
 */
export async function* renderChunks(genome, options, chunking = {}) {
  const { chunkSeconds = CHUNK_SECONDS, from = 0, to = Infinity, signal, starting } = chunking;
  const window = { offset: options.offset ?? 0, duration: options.duration };
  const chunks = wantedChunks(window, { chunkSeconds, from, to });
  for (const [index, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    starting?.(index + 1, chunks.length);
    const { offset, duration } = chunk;
    const { channels } = await renderOffline(genome, { ...options, offset, duration });
    if (channels[0]?.length !== chunk.frames) {
      throw new Error(
        `the chunk at ${offset} s rendered ${channels[0]?.length} frames, not ${chunk.frames}`,
      );
    }
    yield { ...chunk, channels };
  }
}

/**
 * The chunks of a window that overlap the frames from `from` to before `to`.
 * @param {{ offset: number, duration: number }} window
 * @param {{ chunkSeconds: number, from: number, to: number }} span
 * @returns {ChunkWindow[]}
 */
export const wantedChunks = (window, { chunkSeconds, from, to }) =>
  chunkWindows(window, chunkSeconds).filter(
    ({ frame, frames }) => frame + frames > from && frame < to,
  );

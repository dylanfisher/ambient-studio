// How a long window of a genome's timeline renders as several shorter ones (decision 0062). Each
// chunk is its own offline render with its own pre-roll, and matches the same span of one render
// of the whole window within 0007's tolerance; the split decides the exact samples, so the chunk
// length is part of what a track's audio depends on, named in its manifest.
import { SAMPLE_RATE } from "./render-plan.js";

/**
 * Seconds of timeline a chunk renders, before its pre-roll. Longer chunks spend less on pre-roll
 * (up to about 45 s with a 20 s reverb) and hold more: 120 s of stereo is 46 MB, held about
 * twice while a chunk is trimmed. Changing it changes a track's samples and bumps the engine
 * version.
 */
export const CHUNK_SECONDS = 120;

/**
 * One chunk: its window on the genome's timeline, and where its frames sit in the whole
 * window's.
 * @typedef {object} ChunkWindow
 * @property {number} offset timeline seconds
 * @property {number} duration seconds
 * @property {number} frame the chunk's first frame, counted from the window's first
 * @property {number} frames
 */

/**
 * The chunks of a window, in order. Boundaries sit on multiples of the chunk length from the
 * window's own start, so a window always splits the same way wherever it sits on the timeline.
 * The last chunk ends exactly at the window's end, so it never runs past a genome whose
 * duration is that end.
 * @param {{ offset: number, duration: number }} window timeline seconds
 * @param {number} [seconds] the chunk length; `CHUNK_SECONDS` when omitted
 * @returns {ChunkWindow[]}
 */
export function chunkWindows({ offset, duration }, seconds = CHUNK_SECONDS) {
  if (!(duration > 0 && Number.isFinite(duration))) {
    throw new RangeError(`a window to split must be above 0 s, got ${duration}`);
  }
  if (!(seconds > 0 && Number.isInteger(seconds * SAMPLE_RATE))) {
    throw new RangeError(`a chunk must be a whole number of frames long, got ${seconds} s`);
  }
  const total = Math.round(duration * SAMPLE_RATE);
  const step = seconds * SAMPLE_RATE;
  const end = offset + duration;
  /** @type {ChunkWindow[]} */
  const chunks = [];
  for (let frame = 0; frame < total; frame += step) {
    const frames = Math.min(step, total - frame);
    const at = offset + frame / SAMPLE_RATE;
    const last = frame + frames === total;
    chunks.push({ offset: at, duration: last ? end - at : frames / SAMPLE_RATE, frame, frames });
  }
  return chunks;
}

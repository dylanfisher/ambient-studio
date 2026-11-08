// A track's mix, a block at a time in track order (decision 0062): each section's window through
// `renderChunks`, the end of one and the start of the next summed with the equal-power
// crossfade, and the track's own fades on its first and last frames. It holds one chunk and
// the overlap still waiting for the next section, never the whole track, and can render only
// the chunks a span needs, as the seam preview does.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Samples } from "../engine/render.js" */
/** @import { RenderedChunk } from "./render-chunks.js" */
import { trackFadeGain } from "../domain/track-fades.js";
import { CHUNK_SECONDS } from "../engine/chunk-windows.js";
import { crossfadeGains } from "../engine/crossfade.js";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { JOB_STEP } from "./job-steps.js";
import { renderChunks, wantedChunks } from "./render-chunks.js";

const CHANNELS = 2;

/**
 * One section as it renders: its fitted genome (`sectionGenome`), its sketch's seed and its
 * window on the genome's timeline.
 * @typedef {object} PlannedSection
 * @property {Genome} genome
 * @property {number} seed
 * @property {number} offset timeline seconds
 * @property {number} duration seconds, the section's
 * @property {Samples} [samples] the recordings its genome plays
 */

/**
 * Everything a track's mix is made from, which its manifest records.
 * @typedef {object} TrackPlan
 * @property {PlannedSection[]} sections in the order they play
 * @property {number[]} transitions each crossfade's seconds, one between each pair of neighbors
 * @property {{ fadeIn: number, fadeOut: number }} fades the track's own, in seconds
 */

/**
 * @typedef {object} MixOptions
 * @property {number} [chunkSeconds] `CHUNK_SECONDS` when omitted; tests pass seconds
 * @property {number} [from] the first track frame wanted, 0 when omitted
 * @property {number} [to] the track frame after the last wanted, the track's end when omitted
 * @property {AbortSignal} [signal] checked before each chunk
 * @property {(done: number, total: number, step: string) => void} [progress] before each chunk
 * @property {(genome: Genome) => readonly string[]} [voices] limits each section's render to
 *   the voices this gives for its genome, as a stem does; every voice when omitted
 */

/** @param {number} seconds */
const framesOf = (seconds) => Math.round(seconds * SAMPLE_RATE);

/**
 * Where each section starts on the track, in frames, and the track's length.
 * @param {{ sections: readonly { duration: number }[], transitions: readonly number[] }} plan
 */
export function trackLayout({ sections, transitions }) {
  /** @type {number[]} */
  const starts = [];
  let at = 0;
  sections.forEach(({ duration }, i) => {
    starts.push(at);
    at += framesOf(duration) - framesOf(transitions[i] ?? 0);
  });
  return { starts, frames: at + framesOf(transitions[sections.length - 1] ?? 0) };
}

/**
 * The track's length in frames.
 * @param {TrackPlan} plan
 */
export const trackFrames = (plan) => trackLayout(plan).frames;

/**
 * The mix from `from` to `to`, as consecutive blocks of every channel; together they hold
 * exactly that span. Each block is a view of one buffer the next block overwrites, so a caller
 * that keeps one copies it before asking for the next. Throws on a plan whose transitions don't
 * match its sections.
 * @param {TrackPlan} plan
 * @param {MixOptions} [options]
 * @returns {AsyncGenerator<Float32Array[]>}
 */
export async function* mixTrack(plan, options = {}) {
  const { sections, transitions, fades } = plan;
  if (transitions.length !== Math.max(0, sections.length - 1)) {
    throw new Error(
      `a track of ${sections.length} sections has ${transitions.length} transitions, not one between each pair`,
    );
  }
  const { starts, frames: total } = trackLayout(plan);
  const { chunkSeconds = CHUNK_SECONDS, signal, progress, voices } = options;
  const from = Math.max(0, options.from ?? 0);
  const to = Math.min(total, options.to ?? total);
  const fadeFrames = {
    fadeIn: framesOf(fades.fadeIn),
    fadeOut: framesOf(fades.fadeOut),
    frames: total,
  };

  // Track frames from `emitted` on that some section has added to and none has finished.
  let emitted = from;
  /** @type {Float32Array[]} */
  let pending = Array.from({ length: CHANNELS }, () => new Float32Array(0));
  /** The buffer every yielded block is a view of, grown to the largest. */
  let blocks = Array.from({ length: CHANNELS }, () => new Float32Array(0));

  /**
   * The pending frames before `frontier`, with the track's fades, removed from `pending`.
   * @param {number} frontier
   */
  function take(frontier) {
    const count = frontier - emitted;
    if ((blocks[0]?.length ?? 0) < count) {
      blocks = blocks.map(() => new Float32Array(count));
    }
    const block = blocks.map((buffer, c) => {
      const view = buffer.subarray(0, count);
      view.set(/** @type {Float32Array} */ (pending[c]).subarray(0, count));
      return view;
    });
    // Only the frames inside a fade change; the gain is 1 between them.
    const faded = [
      [emitted, Math.min(frontier, fadeFrames.fadeIn)],
      [Math.max(emitted, total - fadeFrames.fadeOut), frontier],
    ];
    for (const channel of block) {
      for (const [first, end] of faded) {
        for (let t = /** @type {number} */ (first); t < /** @type {number} */ (end); t++) {
          const i = t - emitted;
          channel[i] = /** @type {number} */ (channel[i]) * trackFadeGain(t, fadeFrames);
        }
      }
    }
    // In place: a new buffer for each take would leave one more chunk of garbage a chunk.
    for (const channel of pending) {
      channel.copyWithin(0, count);
      channel.fill(0, channel.length - count);
    }
    emitted = frontier;
    return block;
  }

  const wanted = sections.map(({ offset, duration }, i) =>
    wantedChunks(
      { offset, duration },
      { chunkSeconds, from: from - (starts[i] ?? 0), to: to - (starts[i] ?? 0) },
    ),
  );
  const count = wanted.reduce((sum, chunks) => sum + chunks.length, 0);
  let done = 0;

  for (const [index, section] of sections.entries()) {
    const start = /** @type {number} */ (starts[index]);
    const length = framesOf(section.duration);
    const fadeIn = framesOf(transitions[index - 1] ?? 0);
    const fadeOut = framesOf(transitions[index] ?? 0);
    const next = starts[index + 1] ?? total;
    const { genome, seed, offset, duration, samples } = section;
    const rendered = renderChunks(
      genome,
      { seed, offset, duration, samples, ...(voices && { voices: voices(genome) }) },
      {
        chunkSeconds,
        from: from - start,
        to: to - start,
        ...(signal && { signal }),
        starting: (number, chunks) => {
          progress?.(
            done,
            count,
            JOB_STEP.renderingTrack(index + 1, sections.length, number, chunks),
          );
          done += 1;
        },
      },
    );
    for (;;) {
      const step = await rendered.next();
      if (step.done) break;
      /** @type {RenderedChunk | null} */
      let chunk = step.value;
      // The chunk's frames that fall in the span, in section frames.
      const first = Math.max(chunk.frame, from - start);
      const last = Math.min(chunk.frame + chunk.frames, to - start);
      grow(start + last - emitted);
      for (const [c, samples] of chunk.channels.entries()) {
        const out = /** @type {Float32Array} */ (pending[c]);
        for (let j = first; j < last; j++) {
          let gain = 1;
          if (j < fadeIn) gain = crossfadeGains(j, fadeIn).rise;
          else if (j >= length - fadeOut)
            gain = crossfadeGains(j - (length - fadeOut), fadeOut).fall;
          const at = start + j - emitted;
          out[at] =
            /** @type {number} */ (out[at]) +
            /** @type {number} */ (samples[j - chunk.frame]) * gain;
        }
      }
      const frontier = Math.min(start + chunk.frame + chunk.frames, next, to);
      // Dropped before yielding, so the chunk isn't alive while the block is written.
      chunk = null;
      if (frontier > emitted) yield take(frontier);
    }
    const frontier = Math.min(next, to);
    if (frontier > emitted) yield take(frontier);
  }
  if (to > emitted) yield take(to);

  /**
   * Makes `pending` hold at least `frames` frames, keeping what it holds.
   * @param {number} frames
   */
  function grow(frames) {
    if ((pending[0]?.length ?? 0) >= frames) return;
    pending = pending.map((channel) => {
      const larger = new Float32Array(frames);
      larger.set(channel);
      return larger;
    });
  }
}

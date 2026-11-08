// What a track costs to render (decisions 0062, 0064): the most cost sounding at once, which is
// two sections during a crossfade or a morph's handover since both render, and the work its
// chunks take, each chunk's pre-roll included. The estimate divides the work by a rate, from the
// last track render or the bench before any.
/** @import { Arrangement } from "./arrangement-schema.js" */
import { CHUNK_SECONDS, chunkWindows } from "../engine/chunk-windows.js";
import { cost } from "../engine/cost.js";
import { preRoll } from "../engine/render-plan.js";
import { arrangementLength } from "./arrangement-length.js";
import { sectionGenome, sectionWindow } from "./section-genome.js";

/**
 * Node-seconds of render work a wall second, for a whole track render with its normalize and
 * encoding, before any track has rendered: from `./scripts/bench --track` on mbp2021 (0062).
 */
export const BENCH_RATE = 4000;

/**
 * @typedef {object} TrackCost
 * @property {number} peak node-seconds a second at the busiest moment: one section's cost, or
 *   two sections' in a crossfade
 * @property {number} work node-seconds rendered: each chunk's cost times its length and
 *   pre-roll
 * @property {number} audio seconds of the sections' windows, overlaps counted in each
 * @property {number} length the track's seconds
 */

/**
 * @param {Arrangement} arrangement a valid one
 * @param {ReadonlyMap<number, unknown>} genomes each sketch's stored genome, by sketch id
 * @param {number} [chunkSeconds] `CHUNK_SECONDS` when omitted
 * @returns {TrackCost}
 */
export function trackCost(arrangement, genomes, chunkSeconds = CHUNK_SECONDS) {
  const costs = arrangement.sections.map((_, index) => {
    const genome = sectionGenome(arrangement, index, genomes);
    const each = cost(genome);
    const window = sectionWindow(arrangement, index, genomes);
    const work = chunkWindows(window, chunkSeconds).reduce(
      (sum, chunk) => sum + each * (chunk.duration + preRoll(genome, chunk.offset)),
      0,
    );
    return { each, work, audio: window.duration };
  });
  const pairs = costs.slice(1).map(({ each }, i) => each + (costs[i]?.each ?? 0));
  return {
    peak: Math.max(0, ...costs.map(({ each }) => each), ...pairs),
    work: costs.reduce((sum, { work }) => sum + work, 0),
    audio: costs.reduce((sum, { audio }) => sum + audio, 0),
    length: arrangementLength(arrangement),
  };
}

/**
 * The estimated wall seconds of a track render.
 * @param {TrackCost} found
 * @param {number} rate node-seconds a wall second
 */
export const trackSeconds = ({ work }, rate) => work / rate;

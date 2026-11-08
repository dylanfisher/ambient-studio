// A window rendered in chunks (decision 0062) matches one render of the same window within
// 0007's excerpt tolerance, at every seam (acceptance 2). Short chunks stand in for 120 s ones,
// so the test renders seconds.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { expect, test } from "vitest";
import bellGenome from "../../src/engine/genomes/bell.json" with { type: "json" };
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { renderChunks } from "../../src/server/render-chunks.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { difference, EXCERPT_BELOW_DB, EXCERPT_PEAK } from "../support/compare-renders.js";

const genome = requireGenome(droneGenome, "drone");
const window = { seed: 3, offset: 7.5, duration: 7 };
const CHUNK = 2;

/**
 * Renders `window` in chunks and whole, and checks the joined chunks against the whole within
 * the excerpt tolerance, over the window and over half a second either side of each seam.
 * @param {Genome} genome
 * @param {{ seed: number, offset: number, duration: number }} window
 * @param {number} chunkSeconds
 * @returns {Promise<number[]>} each chunk's start, in seconds from the window's
 */
async function expectSeamsMatch(genome, window, chunkSeconds) {
  /** @type {{ frame: number, channels: Float32Array[] }[]} */
  const chunks = [];
  for await (const chunk of renderChunks(genome, window, { chunkSeconds })) chunks.push(chunk);
  const whole = await renderOffline(genome, window);
  const frames = Math.round(window.duration * SAMPLE_RATE);
  const joined = [0, 1].map((c) => {
    const out = new Float32Array(frames);
    for (const { frame, channels } of chunks) {
      out.set(/** @type {Float32Array} */ (channels[c]), frame);
    }
    return out;
  });
  const all = difference({ ...whole, channels: joined }, whole);
  expect(all.peak).toBeLessThan(EXCERPT_PEAK);
  expect(all.belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  const half = SAMPLE_RATE / 2;
  for (const { frame } of chunks.slice(1)) {
    const span = (/** @type {Float32Array[]} */ channels) =>
      channels.map((c) => c.slice(frame - half, frame + half));
    const seam = difference(
      { ...whole, channels: span(joined) },
      { ...whole, channels: span(whole.channels) },
    );
    expect(seam.peak).toBeLessThan(EXCERPT_PEAK);
    expect(seam.belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  }
  return chunks.map(({ frame }) => frame / SAMPLE_RATE);
}

test("chunks join to one render of the window within the excerpt tolerance at every seam", async () => {
  expect(await expectSeamsMatch(genome, window, CHUNK)).toEqual([0, 2, 4, 6]);
});

test("the seam holds with a 10 s reverb and the bell's seeded strikes in the pre-roll", async () => {
  // About 18 s of pre-roll before each 2 s chunk: the reverb, the echo and the longest note.
  const long = requireGenome({ ...bellGenome, reverbDecay: 10 }, "bell, long reverb");
  const starts = await expectSeamsMatch(long, { seed: 5, offset: 20, duration: 4 }, 2);
  expect(starts).toEqual([0, 2]);
});

test("only the chunks a span of frames needs are rendered", async () => {
  const wanted = { from: 2.5 * SAMPLE_RATE, to: 4.5 * SAMPLE_RATE };
  /** @type {number[]} */
  const frames = [];
  for await (const chunk of renderChunks(genome, window, { chunkSeconds: CHUNK, ...wanted })) {
    frames.push(chunk.frame / SAMPLE_RATE);
  }
  expect(frames).toEqual([2, 4]);
});

test("an aborted signal stops before the next chunk", async () => {
  const controller = new AbortController();
  /** @type {number[]} */
  const frames = [];
  const run = async () => {
    for await (const chunk of renderChunks(genome, window, {
      chunkSeconds: CHUNK,
      signal: controller.signal,
    })) {
      frames.push(chunk.frame);
      controller.abort(new Error("stop"));
    }
  };
  await expect(run()).rejects.toThrow("stop");
  expect(frames).toEqual([0]);
});

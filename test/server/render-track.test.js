// A track render (decision 0062): the mix streamed to a raw float file under the given temp
// folder, normalized with 6a's streaming forms to its target under the ceiling, and written as
// a 24-bit WAV whose PCM is the hash it reports and an MP3 preview. Cancel stops at the next
// chunk and leaves no temp file. Sections are seconds long.
/** @import { TrackPlan } from "../../src/server/mix-track.js" */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { normalize } from "../../src/domain/normalize.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { mixTrack } from "../../src/server/mix-track.js";
import { renderTrack } from "../../src/server/render-track.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { headerBytes, PCM24 } from "../../src/server/wav-writer.js";
import { decodeMp3 } from "../support/mp3.js";

const genome = requireGenome({ ...droneGenome, fadeIn: 0, fadeOut: 0 }, "drone");

/** @type {TrackPlan} */
const plan = {
  sections: [
    { genome, seed: 1, offset: 6, duration: 4 },
    { genome: { ...genome, key: 5 }, seed: 2, offset: 20, duration: 5 },
  ],
  transitions: [2],
  fades: { fadeIn: 1, fadeOut: 2 },
};
const loudness = { target: -18, ceiling: -1 };
const CHUNK = 2;

/** @type {string} */
let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "render-track-"));
});
afterEach(async () => {
  await rm(root, { recursive: true });
});

test("a track normalizes to its target under its ceiling, and its WAV holds the PCM it hashes", async () => {
  const tempDir = await mkdtemp(join(root, "temp-"));
  const wav = join(root, "mix.wav");
  const mp3 = join(root, "mix.mp3");
  const done = await renderTrack(plan, { loudness, tempDir, wav, mp3, chunkSeconds: CHUNK });
  expect(done.frames).toBe(7 * SAMPLE_RATE);
  expect(Math.abs(done.loudness.integrated - loudness.target)).toBeLessThanOrEqual(0.1);
  expect(done.loudness.truePeak).toBeLessThanOrEqual(loudness.ceiling);
  expect(done.loudness).toMatchObject(loudness);

  const pcm = (await readFile(wav)).subarray(headerBytes(PCM24));
  expect(sha256Hex(pcm)).toBe(done.pcmSha256);
  // The streaming path gives normalize's bits for the whole mix (0060).
  /** @type {Float32Array[][]} */
  const blocks = [];
  for await (const block of mixTrack(plan, { chunkSeconds: CHUNK })) {
    blocks.push(block.map((channel) => channel.slice()));
  }
  const whole = [0, 1].map((c) => {
    const out = new Float32Array(done.frames);
    let at = 0;
    for (const block of blocks) {
      out.set(/** @type {Float32Array} */ (block[c]), at);
      at += block[c]?.length ?? 0;
    }
    return out;
  });
  const normalized = normalize(whole, SAMPLE_RATE, loudness);
  expect(sha256Hex(encodePcm24(normalized.channels))).toBe(done.pcmSha256);
  expect(done.loudness.gainDb).toBe(normalized.gainDb);

  expect((await decodeMp3(mp3))[0]?.length).toBe(done.frames);
  expect(await readdir(tempDir)).toEqual([]);
});

test("cancel stops at the next chunk and removes the temp files", async () => {
  const tempDir = await mkdtemp(join(root, "temp-"));
  const controller = new AbortController();
  /** @type {string[]} */
  const steps = [];
  const wav = join(root, "mix.wav");
  const run = renderTrack(plan, {
    loudness,
    tempDir,
    wav,
    mp3: join(root, "mix.mp3"),
    chunkSeconds: CHUNK,
    signal: controller.signal,
    progress: (_done, _total, step) => {
      if (step) steps.push(step);
      if (steps.length === 2) controller.abort(new Error("cancelled"));
    },
  });
  await expect(run).rejects.toThrow("cancelled");
  expect(steps).toEqual([
    "Rendering section 1 of 2, chunk 1 of 2",
    "Rendering section 1 of 2, chunk 2 of 2",
  ]);
  expect(await readdir(tempDir)).toEqual([]);
  expect(existsSync(wav)).toBe(false);
});

test("without a WAV it only hashes, as a re-render does", async () => {
  const tempDir = await mkdtemp(join(root, "temp-"));
  const first = await renderTrack(plan, { loudness, tempDir, chunkSeconds: CHUNK });
  expect(first.pcmSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(await readdir(root)).toEqual([tempDir.slice(root.length + 1)]);
});

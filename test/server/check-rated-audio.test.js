// Every rated excerpt's FLAC exists and decodes to the PCM its row hashes (decision 0021).
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { checkRatedAudio } from "../../src/server/check-rated-audio.js";
import { putGenome } from "../../src/server/generation-store.js";
import { addRatedAudio } from "../../src/server/rating-store.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { writeFlac } from "../../src/server/write-flac.js";
import { writeWav } from "../../src/server/write-wav.js";
import { heardExcerpt, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** 0.1 s of stereo 24-bit PCM in which every byte varies. */
function testPcm() {
  const pcm = new Uint8Array(4800 * 6);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 31 + 7) % 256;
  return pcm;
}

/**
 * Writes `pcm` as a FLAC at `path`.
 * @param {string} path
 * @param {Uint8Array} pcm
 */
async function writeFlacOf(path, pcm) {
  const wav = `${path}.wav`;
  await writeWav(wav, pcm, { channelCount: 2, sampleRate: 48000 });
  await writeFlac(wav, path);
  await rm(wav);
}

/** A store with one rated excerpt whose FLAC is in the rated-audio folder. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store, paths } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const genome = putGenome(store, vibe.id, droneGenome);
  await mkdir(paths.ratedAudio);
  const pcm = testPcm();
  const file = join(paths.ratedAudio, "one.flac");
  await writeFlacOf(file, pcm);
  const row = {
    ...heardExcerpt(genome.id),
    target: -16,
    file: "one.flac",
    pcmSha256: sha256Hex(pcm),
    gainDb: 0,
  };
  addRatedAudio(store, row);
  return { ...made, pcm, file, row };
}

test("passes when every file decodes to its hash", async () => {
  const { store, paths } = await setup();
  await expect(checkRatedAudio(store, paths.ratedAudio)).resolves.toBe(1);
});

test("fails on a missing file, naming it", async () => {
  const { store, paths, file } = await setup();
  await rm(file);
  await expect(checkRatedAudio(store, paths.ratedAudio)).rejects.toThrow(/one\.flac.*missing/);
});

test("fails on a changed byte, naming both hashes", async () => {
  const { store, paths, file, pcm, row } = await setup();
  const changed = pcm.slice();
  const byte = /** @type {number} */ (pcm[1000]);
  changed[1000] = (byte + 1) % 256;
  await rm(file);
  await writeFlacOf(file, changed);
  await expect(checkRatedAudio(store, paths.ratedAudio)).rejects.toThrow(
    new RegExp(`one\\.flac.*${sha256Hex(changed)}.*${row.pcmSha256}`),
  );
});

test("fails on a file that isn't a FLAC, with flac's message", async () => {
  const { store, paths, file, pcm } = await setup();
  await rm(file);
  await writeWav(file, pcm, { channelCount: 2, sampleRate: 48000 });
  await expect(checkRatedAudio(store, paths.ratedAudio)).rejects.toThrow(/one\.flac.*flac/s);
});

test("refuses a row whose file would sit outside the folder", async () => {
  const { store, paths, row } = await setup();
  addRatedAudio(store, { ...row, seed: 8, file: "../outside.flac" });
  await expect(checkRatedAudio(store, paths.ratedAudio)).rejects.toThrow(/outside/);
});

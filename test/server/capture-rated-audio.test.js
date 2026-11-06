// Capturing a heard excerpt as rated audio (decision 0026): the cached WAV kept as FLAC, one
// row per heard identity, with its PCM hash and gain.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { captureRatedAudio } from "../../src/server/capture-rated-audio.js";
import { checkRatedAudio } from "../../src/server/check-rated-audio.js";
import { putGenome } from "../../src/server/generation-store.js";
import { readFlacPcm } from "../../src/server/read-flac-pcm.js";
import { renderExcerpt } from "../../src/server/render-excerpt.js";
import { putRender } from "../../src/server/render-store.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** Bytes of the plain header `writeWav` writes before the PCM. */
const WAV_HEADER_BYTES = 44;

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A store with the drone golden's excerpt rendered into the cache. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store, paths } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const genome = putGenome(store, vibe.id, droneGenome);
  const { render } = await renderExcerpt(store, paths.renderCache, {
    genomeId: genome.id,
    seed: 7,
    target: -18,
  });
  return { ...made, vibeId: vibe.id, render };
}

test("writes the heard excerpt as a FLAC whose decoded PCM matches its row", async () => {
  const { store, paths, render } = await setup();
  const rated = await captureRatedAudio(store, paths, render.id);

  const flac = join(paths.ratedAudio, rated.file);
  const pcm = await readFlacPcm(flac);
  const wav = await readFile(join(paths.renderCache, render.file));
  expect(Buffer.from(pcm).equals(wav.subarray(WAV_HEADER_BYTES))).toBe(true);
  expect(rated).toMatchObject({
    genomeId: render.genomeId,
    seed: render.seed,
    offset: render.offset,
    duration: render.duration,
    engineVersion: ENGINE_VERSION,
    target: -18,
    pcmSha256: sha256Hex(pcm),
    gainDb: /** @type {{ heard: { gainDb: number } }} */ (render.features).heard.gainDb,
  });
  expect(await checkRatedAudio(store, paths.ratedAudio)).toBe(1);
});

test("a second capture of the same excerpt reuses the row and its file", async () => {
  const { store, paths, render } = await setup();
  const first = await captureRatedAudio(store, paths, render.id);
  const second = await captureRatedAudio(store, paths, render.id);
  expect(second).toEqual(first);
  expect(await readdir(paths.ratedAudio)).toEqual([first.file]);
});

test("a render made under another producer, or an unknown one, is refused", async () => {
  const { store, paths, render } = await setup();
  const { render: stale } = putRender(store, { ...render, producer: "engine-1 features-old" });
  await expect(captureRatedAudio(store, paths, stale.id)).rejects.toThrow(
    /made under producer engine-1 features-old/,
  );
  await expect(captureRatedAudio(store, paths, 999)).rejects.toThrow(/no render 999/);
  expect(existsSync(paths.ratedAudio)).toBe(false);
});

test("an excerpt normalize couldn't lift is kept as rendered, with no gain", async () => {
  const { store, paths, vibeId } = await setup();
  const silent = {
    ...droneGenome,
    voices: droneGenome.voices.map((voice) => ({ ...voice, start: 55 })),
  };
  const genome = putGenome(store, vibeId, silent);
  const quiet = await renderExcerpt(store, paths.renderCache, {
    genomeId: genome.id,
    seed: 7,
    target: -18,
  });
  expect(quiet.render.features).toMatchObject({ heard: null });
  const rated = await captureRatedAudio(store, paths, quiet.render.id);
  expect(rated.gainDb).toBe(0);
  expect(await checkRatedAudio(store, paths.ratedAudio)).toBe(1);
});

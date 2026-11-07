// Capturing a heard excerpt as rated audio (decisions 0026 and 0048): the excerpt rendered
// again and kept as FLAC, the exact normalized PCM the cached MP3 was encoded from, one row per
// heard identity, with its PCM hash and gain.
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { normalize } from "../../src/domain/normalize.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { captureRatedAudio } from "../../src/server/capture-rated-audio.js";
import { checkRatedAudio } from "../../src/server/check-rated-audio.js";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { putGenome } from "../../src/server/generation-store.js";
import { readFlacPcm } from "../../src/server/read-flac-pcm.js";
import { renderExcerpt } from "../../src/server/render-excerpt.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { putRender } from "../../src/server/render-store.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** No genome here plays a field recording, so the capture is given an empty index. */
const NO_RECORDINGS = async () => [];

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

test("writes the heard excerpt as a FLAC of the exact normalized PCM, whose hash checks", async () => {
  const { store, paths, render } = await setup();
  const rated = await captureRatedAudio(store, paths, render.id, NO_RECORDINGS);

  const flac = join(paths.ratedAudio, rated.file);
  const pcm = await readFlacPcm(flac);
  const genome = requireGenome(droneGenome, "the drone golden");
  const raw = await renderOffline(genome, {
    seed: render.seed,
    duration: render.duration,
    offset: render.offset,
    samples: {},
  });
  const heard = normalize(raw.channels, raw.sampleRate, {
    target: -18,
    ceiling: genome.ceiling,
  });
  expect(Buffer.from(pcm).equals(encodePcm24(heard.channels))).toBe(true);
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

test("needs no lossless file in the render cache, and leaves nothing beside the MP3", async () => {
  const { store, paths, render } = await setup();
  expect(await readdir(paths.renderCache)).toEqual([render.file]);
  // The MP3 is only for playback: the FLAC is made without it.
  await rm(join(paths.renderCache, render.file));
  await captureRatedAudio(store, paths, render.id, NO_RECORDINGS);
  expect(await readdir(paths.renderCache)).toEqual([]);
  expect(await checkRatedAudio(store, paths.ratedAudio)).toBe(1);
});

test("refuses an excerpt that renders differently from its row", async () => {
  const { store, paths, render } = await setup();
  const features = /** @type {{ heard: { gainDb: number } }} */ (render.features);
  const { render: drifted } = putRender(store, {
    ...render,
    features: { ...features, heard: { ...features.heard, gainDb: features.heard.gainDb + 1 } },
  });
  await expect(captureRatedAudio(store, paths, drifted.id, NO_RECORDINGS)).rejects.toThrow(
    /came out different when rendered again/,
  );
  expect(existsSync(paths.ratedAudio)).toBe(false);
});

test("a second capture of the same excerpt reuses the row and its file", async () => {
  const { store, paths, render } = await setup();
  const first = await captureRatedAudio(store, paths, render.id, NO_RECORDINGS);
  const second = await captureRatedAudio(store, paths, render.id, NO_RECORDINGS);
  expect(second).toEqual(first);
  expect(await readdir(paths.ratedAudio)).toEqual([first.file]);
});

test("two captures of one excerpt at once both return the one row", async () => {
  const { store, paths, render } = await setup();
  const [a, b] = await Promise.all([
    captureRatedAudio(store, paths, render.id, NO_RECORDINGS),
    captureRatedAudio(store, paths, render.id, NO_RECORDINGS),
  ]);
  expect(b).toEqual(a);
  expect(await readdir(paths.ratedAudio)).toEqual([a.file]);
});

test("a render made under another producer, or an unknown one, is refused", async () => {
  const { store, paths, render } = await setup();
  const { render: stale } = putRender(store, { ...render, producer: "engine-1 features-old" });
  await expect(captureRatedAudio(store, paths, stale.id, NO_RECORDINGS)).rejects.toThrow(
    /made under producer engine-1 features-old/,
  );
  await expect(captureRatedAudio(store, paths, 999, NO_RECORDINGS)).rejects.toThrow(
    /no render 999/,
  );
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
  const rated = await captureRatedAudio(store, paths, quiet.render.id, NO_RECORDINGS);
  expect(rated.gainDb).toBe(0);
  expect(await checkRatedAudio(store, paths.ratedAudio)).toBe(1);
});

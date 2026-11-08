// Excerpt renders (decision 0026): a window at the candidate's seed and excerpt offset (0007),
// normalized to the vibe's target, measured, checked and cached as an MP3 (0048) with a renders
// row.
import { existsSync } from "node:fs";
import { readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { afterEach, describe, expect, test } from "vitest";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { NEAR_SILENCE } from "../../src/domain/render-checks.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import recordingGenome from "../../src/engine/genomes/field-recording.json" with { type: "json" };
import noiseBedGenome from "../../src/engine/genomes/noise-bed.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { putGenome } from "../../src/server/generation-store.js";
import { createJobRunner } from "../../src/server/job-runner.js";
import { PRODUCER } from "../../src/server/producer.js";
import { indexRecordings } from "../../src/server/recording-index.js";
import {
  NORMALIZE_FAILED,
  renderExcerpt,
  renderExcerpts,
  vibeLoudness,
} from "../../src/server/render-excerpt.js";
import { putRender } from "../../src/server/render-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { MP3_KBPS } from "../../src/server/write-mp3.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";
import { decodeMp3, mp3Frames } from "../support/mp3.js";
import { tempStore } from "../support/temp-store.js";

v8.setFlagsFromString("--expose-gc");
const collectGarbage = /** @type {() => void} */ (vm.runInNewContext("gc"));

const SEED = 7;
const TARGET = -20;
/** The drone golden with its one voice entering after every excerpt window has ended. */
const silentGenome = {
  ...droneGenome,
  voices: droneGenome.voices.map((voice) => ({ ...voice, start: 55 })),
};

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A store holding the drone golden and the silent genome under one vibe. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const drone = putGenome(store, vibe.id, droneGenome);
  const silent = putGenome(store, vibe.id, silentGenome);
  const noise = putGenome(store, vibe.id, noiseBedGenome);
  return {
    ...made,
    cache: made.paths.renderCache,
    drone: drone.id,
    silent: silent.id,
    noise: noise.id,
  };
}

/** @param {string} folder */
const filesIn = (folder) => readdir(folder);

test("an excerpt's target is the vibe's fixed loudness, or the schema's default", () => {
  expect(vibeLoudness({ loudness: -14 })).toBe(-14);
  expect(vibeLoudness({})).toBe(-16);
});

describe("renderExcerpt", () => {
  test("renders the candidate's window at the target loudness, with features and checks", async () => {
    const { store, cache, drone } = await setup();
    const { render, cached } = await renderExcerpt(store, cache, {
      genomeId: drone,
      seed: SEED,
      target: TARGET,
    });
    const genome = requireGenome(droneGenome, "the drone golden");
    expect(cached).toBe(false);
    expect(render).toMatchObject({
      genomeId: drone,
      seed: SEED,
      offset: excerptOffset(genome, SEED, EXCERPT_SECONDS),
      duration: EXCERPT_SECONDS,
      target: TARGET,
      producer: PRODUCER,
      checks: { ok: true, findings: [] },
    });
    expect(render.file).toMatch(/\.mp3$/);
    const frames = mp3Frames(await readFile(join(cache, render.file)));
    expect(frames.every(({ kbps }) => kbps === MP3_KBPS)).toBe(true);
    const channels = await decodeMp3(join(cache, render.file));
    expect(channels[0]?.length).toBe(EXCERPT_SECONDS * 48000);
    expect(Math.abs(integratedLoudness(channels, 48000) - TARGET)).toBeLessThanOrEqual(0.5);
    expect(render.features).toMatchObject({
      raw: { loudness: expect.any(Number) },
      heard: { gainDb: expect.any(Number), centroidMean: expect.any(Number) },
    });
  });

  test("plays a genome's field recordings from the index it is given, and fails without one", async () => {
    const { store, cache } = await setup();
    const vibe = createVibe(store, { name: "f", brief: "b", constraints: {}, softTargets: {} });
    const { id } = putGenome(store, vibe.id, recordingGenome);
    const request = { genomeId: id, seed: SEED, target: TARGET };
    await expect(renderExcerpt(store, cache, request)).rejects.toThrow(
      /plays a field recording, and no recordings folder was given/,
    );
    const recordings = await indexRecordings(FIXTURE_RECORDINGS);
    const { render } = await renderExcerpt(store, cache, request, recordings);
    expect(render.checks).toEqual({ ok: true, findings: [] });
    const channels = await decodeMp3(join(cache, render.file));
    expect(Math.abs(integratedLoudness(channels, 48000) - TARGET)).toBeLessThanOrEqual(0.5);
  });

  test("reuses a cached excerpt, and renders again under another producer or target", async () => {
    const { store, cache, drone } = await setup();
    const excerpt = { genomeId: drone, seed: SEED, target: TARGET };
    const first = await renderExcerpt(store, cache, excerpt);
    const again = await renderExcerpt(store, cache, excerpt);
    expect(again).toEqual({ render: first.render, cached: true });

    const { render: stale } = putRender(store, {
      ...first.render,
      producer: "engine-1 features-old",
      file: "stale.mp3",
    });
    const fresh = await renderExcerpt(store, cache, excerpt);
    expect(fresh.cached).toBe(false);
    expect(fresh.render.createdAt).toBeGreaterThan(stale.createdAt);
    expect(fresh.render.producer).toBe(PRODUCER);

    const louder = await renderExcerpt(store, cache, { ...excerpt, target: -14 });
    expect(louder.cached).toBe(false);
    expect(louder.render.target).toBe(-14);
    expect(await filesIn(cache)).toEqual([louder.render.file]);
  });

  test("renders again when the cached file is missing", async () => {
    const { store, cache, drone } = await setup();
    const excerpt = { genomeId: drone, seed: SEED, target: TARGET };
    const { render } = putRender(store, {
      ...(await renderExcerpt(store, cache, excerpt)).render,
      file: "gone.mp3",
    });
    const again = await renderExcerpt(store, cache, excerpt);
    expect(again.cached).toBe(false);
    expect(again.render.createdAt).toBeGreaterThan(render.createdAt);
    expect(existsSync(join(cache, again.render.file))).toBe(true);
  });

  test("renders again over a row whose file is a WAV from before MP3, and deletes the WAV", async () => {
    const { store, cache, drone } = await setup();
    const excerpt = { genomeId: drone, seed: SEED, target: TARGET };
    const { render } = await renderExcerpt(store, cache, excerpt);
    await rename(join(cache, render.file), join(cache, "old.wav"));
    putRender(store, { ...render, file: "old.wav" });
    const again = await renderExcerpt(store, cache, excerpt);
    expect(again.cached).toBe(false);
    expect(await filesIn(cache)).toEqual([again.render.file]);
  });

  test("a row cached under the name from before it held the offset still resolves", async () => {
    const { store, cache, drone } = await setup();
    const excerpt = { genomeId: drone, seed: SEED, target: TARGET };
    const { render } = await renderExcerpt(store, cache, excerpt);
    const old = render.file.replace(/-at[^-]+s-/, "-");
    expect(old).not.toBe(render.file);
    await rename(join(cache, render.file), join(cache, old));
    const { render: stored } = putRender(store, { ...render, file: old });
    expect(await renderExcerpt(store, cache, excerpt)).toEqual({ render: stored, cached: true });
  });

  test("with a window, renders that window and names its file by the offset (0061)", async () => {
    const { store, cache, drone } = await setup();
    const excerpt = { genomeId: drone, seed: SEED, target: TARGET };
    const { render } = await renderExcerpt(store, cache, excerpt, undefined, {
      offset: 12.5,
      duration: 3,
    });
    expect(render).toMatchObject({ offset: 12.5, duration: 3 });
    expect(render.file).toContain(`${drone}-seed${SEED}-at12.5s-3s-${TARGET}LUFS-`);
    const other = await renderExcerpt(store, cache, excerpt, undefined, {
      offset: 20,
      duration: 3,
    });
    expect(other.render.file).not.toBe(render.file);
    expect((await filesIn(cache)).sort()).toEqual([render.file, other.render.file].sort());
  });

  test("a window that isn't inside the genome's duration throws, rendering nothing", async () => {
    const { store, cache, drone } = await setup();
    const excerpt = { genomeId: drone, seed: SEED, target: TARGET };
    for (const window of [
      { offset: 58, duration: 3 },
      { offset: -1, duration: 3 },
    ]) {
      await expect(renderExcerpt(store, cache, excerpt, undefined, window)).rejects.toThrow(
        `isn't inside genome ${drone}'s 60 s`,
      );
    }
    expect(existsSync(cache) ? await filesIn(cache) : []).toEqual([]);
  });

  test("is identical rendered twice in one process with forced collection between", async () => {
    const one = await setup();
    const two = await setup();
    const a = await renderExcerpt(one.store, one.cache, {
      genomeId: one.drone,
      seed: 3,
      target: -16,
    });
    collectGarbage();
    const b = await renderExcerpt(two.store, two.cache, {
      genomeId: two.drone,
      seed: 3,
      target: -16,
    });
    const mp3A = await readFile(join(one.cache, a.render.file));
    const mp3B = await readFile(join(two.cache, b.render.file));
    expect(mp3A.equals(mp3B)).toBe(true);
    expect(b.render.features).toEqual(a.render.features);
  });
});

describe("renderExcerpts as a job", () => {
  test("a silent genome gives a failed near-silence check and the job goes on", async () => {
    const { store, cache, drone, silent } = await setup();
    const runner = createJobRunner({ now: () => 0 });
    const job = runner.add("excerpts", (context) =>
      renderExcerpts(
        store,
        cache,
        [
          { genomeId: silent, seed: SEED, target: TARGET },
          { genomeId: drone, seed: SEED, target: TARGET },
        ],
        context,
      ),
    );
    await runner.idle();
    const status = runner.get(job.id);
    expect(status).toMatchObject({ state: "done", progress: { done: 2, total: 2, step: null } });
    const [quiet, loud] = /** @type {import("../../src/server/render-excerpt.js").Excerpt[]} */ (
      status.result
    );
    expect(quiet?.render.checks).toMatchObject({
      ok: false,
      findings: [expect.objectContaining({ rule: NEAR_SILENCE })],
    });
    expect(quiet?.render.features).toMatchObject({ raw: { loudness: null }, heard: null });
    expect(existsSync(join(cache, quiet?.render.file ?? ""))).toBe(true);
    expect(loud?.render.checks).toMatchObject({ ok: true });
  });

  test("normalize failing with near-silence passing is a failed check, and the job goes on", async () => {
    // The noise-bed golden at seed 1 reads -41.6 LUFS, above the near-silence floor, and its
    // limiter stops 2.3 LU short of -10 LUFS (measured on mbp2021 when this test was written).
    const { store, cache, drone, noise } = await setup();
    const runner = createJobRunner({ now: () => 0 });
    const job = runner.add("excerpts", (context) =>
      renderExcerpts(
        store,
        cache,
        [
          { genomeId: noise, seed: 1, target: -10 },
          { genomeId: drone, seed: SEED, target: -10 },
        ],
        context,
      ),
    );
    await runner.idle();
    const status = runner.get(job.id);
    expect(status).toMatchObject({ state: "done", progress: { done: 2, total: 2 } });
    const [peaky, loud] = /** @type {import("../../src/server/render-excerpt.js").Excerpt[]} */ (
      status.result
    );
    expect(peaky?.render.checks).toEqual({
      ok: false,
      findings: [
        {
          path: "$",
          rule: NORMALIZE_FAILED,
          message: expect.stringMatching(/can't reach -10 LUFS/),
        },
      ],
    });
    expect(peaky?.render.features).toMatchObject({
      raw: { loudness: expect.any(Number) },
      heard: null,
    });
    expect(existsSync(join(cache, peaky?.render.file ?? ""))).toBe(true);
    expect(loud?.render.checks).toMatchObject({ ok: true });
  });

  test("says which excerpt it is rendering, and no step once done", async () => {
    const { store, cache, drone } = await setup();
    /** @type {[number, number, string | null][]} */
    const steps = [];
    const excerpts = [1, 2].map((seed) => ({ genomeId: drone, seed, target: TARGET }));
    await renderExcerpts(store, cache, excerpts, {
      signal: new AbortController().signal,
      progress: (done, total, step) => steps.push([done, total, step]),
    });
    expect(steps).toEqual([
      [0, 2, "Rendering excerpt 1 of 2"],
      [1, 2, "Rendering excerpt 2 of 2"],
      [2, 2, null],
    ]);
  });

  test("a cancelled job stops before its next render", async () => {
    const { store, cache, drone } = await setup();
    const runner = createJobRunner({ now: () => 0 });
    const excerpts = [1, 2, 3].map((seed) => ({ genomeId: drone, seed, target: TARGET }));
    const job = runner.add("excerpts", ({ signal, progress }) =>
      renderExcerpts(store, cache, excerpts, {
        signal,
        progress(done, total, step) {
          progress(done, total, step);
          if (done === 1) runner.cancel(job.id);
        },
      }),
    );
    await runner.idle();
    expect(runner.get(job.id)).toMatchObject({
      state: "cancelled",
      progress: { done: 1, total: 3 },
    });
    expect(await filesIn(cache)).toHaveLength(1);
  });
});

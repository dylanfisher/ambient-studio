// The embed job (decision 0042) run directly against the fake sidecar: it embeds only what has
// no row under the sidecar's producer, rebuilds when the producer changes, and a sidecar
// failure fails the job naming the file and keeps the rows already written.
/** @import { TestApp } from "../support/test-app.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { embedJob } from "../../src/server/embed-job.js";
import { findEmbedding, putEmbedding } from "../../src/server/embedding-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addRatedAudio } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
import { markRemoved, TABLE } from "../../src/server/store.js";
import { fillStore, heardExcerpt } from "../support/temp-store.js";
import { testApp } from "../support/test-app.js";

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 4, ready: true };
const VECTOR = [0.5, 0.5, 0.5, 0.5];

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

/**
 * A test app whose config names a checkpoint folder in its temp root, holding two live rated
 * audio rows and a removed one, a render under this server's producer with its file, one under
 * another producer and one whose file is gone.
 */
async function setup() {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  const filled = fillStore(app.store);
  const genomeId = filled.genomes;
  const second = addRatedAudio(app.store, {
    ...heardExcerpt(genomeId),
    seed: 8,
    target: -16,
    file: "drone-8.flac",
    pcmSha256: "1".repeat(64),
    gainDb: 0,
  });
  const removed = addRatedAudio(app.store, {
    ...heardExcerpt(genomeId),
    seed: 9,
    target: -16,
    file: "drone-9.flac",
    pcmSha256: "2".repeat(64),
    gainDb: 0,
  });
  markRemoved(app.store, TABLE.ratedAudio, removed.id, "test");
  /** @param {number} seed @param {string} producer */
  const render = (seed, producer) =>
    putRender(app.store, {
      genomeId,
      seed,
      offset: 0,
      duration: 25,
      target: -16,
      producer,
      file: `render-${seed}.mp3`,
      features: {},
      checks: {},
    }).render;
  const kept = render(1, PRODUCER);
  render(2, "engine-0 features-old");
  render(3, PRODUCER);
  await mkdir(app.paths.renderCache, { recursive: true });
  await writeFile(join(app.paths.renderCache, kept.file), "audio");
  const ratedAudioIds = [filled.rated_audio, second.id];
  return { ...made, checkpointCache, ratedAudioIds, kept };
}

const job = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** @param {Float32Array} floats */
const bytes = (floats) => new Uint8Array(floats.buffer);

/**
 * The `audio` param of every embed_audio request the fake received, in order.
 * @param {TestApp["sidecar"]} sidecar
 */
const embeddedFiles = async (sidecar) =>
  (await sidecar.received())
    .map(({ request }) => /** @type {{ method: string, params: { audio: string } }} */ (request))
    .filter(({ method }) => method === "embed_audio")
    .map(({ params }) => params.audio);

test("embeds only the rated audio and kept renders that have no row", async () => {
  const { app, sidecar, checkpointCache, ratedAudioIds, kept } = await setup();
  const [first, second] = ratedAudioIds;
  putEmbedding(app.store, {
    ratedAudioId: /** @type {number} */ (first),
    renderId: null,
    producer: EMBEDDER.producer,
    vector: bytes(new Float32Array(4)),
  });
  sidecar.script(
    { do: "answer", result: EMBEDDER },
    { do: "answer", result: { windows: 3 }, floats: VECTOR },
    { do: "answer", result: { windows: 3 }, floats: [1, 0, 0, 0] },
  );
  /** @type {[number, number, string | null][]} */
  const reports = [];
  const result = await embedJob(app)({
    signal: new AbortController().signal,
    progress: (done, total, step) => reports.push([done, total, step]),
  });

  expect(result).toEqual({ producer: EMBEDDER.producer, dropped: 0, embedded: 2 });
  const [asked] = (await sidecar.received()).map(({ request }) => request);
  expect(asked).toMatchObject({ method: "embedder", params: { checkpointCache, fetch: true } });
  expect(await embeddedFiles(sidecar)).toEqual([
    join(app.paths.ratedAudio, "drone-8.flac"),
    join(app.paths.renderCache, kept.file),
  ]);
  const source = { ratedAudioId: /** @type {number} */ (second), renderId: null };
  const row = findEmbedding(app.store, source, EMBEDDER.producer);
  expect(row?.vector).toEqual(bytes(new Float32Array(VECTOR)));
  const rendered = { ratedAudioId: null, renderId: kept.id };
  expect(findEmbedding(app.store, rendered, EMBEDDER.producer)).toBeDefined();
  expect(reports).toEqual([
    [0, 0, "Loading the sound-analysis model; the first time, it downloads 0.8 GB"],
    [0, 2, "Analyzing the sound of excerpt 1 of 2"],
    [1, 2, "Analyzing the sound of excerpt 2 of 2"],
    [2, 2, null],
  ]);
});

test("a producer change drops the old rows and embeds everything again", async () => {
  const { app, sidecar, ratedAudioIds, kept } = await setup();
  const sources = [
    ...ratedAudioIds.map((ratedAudioId) => ({ ratedAudioId, renderId: null })),
    { ratedAudioId: null, renderId: kept.id },
  ];
  for (const source of sources) {
    putEmbedding(app.store, {
      .../** @type {any} */ (source),
      producer: "fake-clap@0 clap-old",
      vector: bytes(new Float32Array(4)),
    });
  }
  const embedded = { do: /** @type {const} */ ("answer"), result: { windows: 3 }, floats: VECTOR };
  sidecar.script({ do: "answer", result: EMBEDDER }, embedded, embedded, embedded);

  const result = await embedJob(app)(job());
  expect(result).toEqual({ producer: EMBEDDER.producer, dropped: 3, embedded: 3 });
  for (const source of sources) {
    const row = findEmbedding(app.store, /** @type {any} */ (source), EMBEDDER.producer);
    expect(row?.producer).toBe(EMBEDDER.producer);
  }
  const count = app.store.db.prepare("SELECT count(*) AS n FROM embeddings").get();
  expect(count?.n).toBe(3);
});

test("a sidecar failure fails the job naming the file, and keeps the rows written", async () => {
  const { app, sidecar, ratedAudioIds } = await setup();
  sidecar.script(
    { do: "answer", result: EMBEDDER },
    { do: "answer", result: { windows: 3 }, floats: VECTOR },
    { do: "error", error: "embed_audio raised ValueError: ffmpeg can't decode it" },
  );
  const file = join(app.paths.ratedAudio, "drone-8.flac");
  await expect(embedJob(app)(job())).rejects.toThrow(
    `embedding ${file} failed: sidecar request embed_audio failed: embed_audio raised ValueError: ffmpeg can't decode it`,
  );
  const source = { ratedAudioId: /** @type {number} */ (ratedAudioIds[0]), renderId: null };
  expect(findEmbedding(app.store, source, EMBEDDER.producer)).toBeDefined();
  const count = app.store.db.prepare("SELECT count(*) AS n FROM embeddings").get();
  expect(count?.n).toBe(1);
});

test("a vector of the wrong length fails the job and stores nothing", async () => {
  const { app, sidecar } = await setup();
  sidecar.script(
    { do: "answer", result: EMBEDDER },
    { do: "answer", result: { windows: 3 }, floats: [1, 0] },
  );
  await expect(embedJob(app)(job())).rejects.toThrow(/wrote 8 bytes for .*, not 4 floats/);
  const count = app.store.db.prepare("SELECT count(*) AS n FROM embeddings").get();
  expect(count?.n).toBe(0);
});

test("with no checkpoint folder in the config the job fails and starts no sidecar", async () => {
  const { app, sidecar } = await setup();
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache: null } };
  await expect(embedJob(app)(job())).rejects.toThrow(NO_CHECKPOINT_CACHE);
  expect(await sidecar.starts()).toEqual([]);
});

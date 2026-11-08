// The Analyze job (decision 0051) run directly against the fake sidecar and a reference made by
// ffmpeg from seeded noise and a sine: each window's features are what `extractFeatures` reads
// on the decoded, normalized window, the embedding is the unit mean of the windows', and a
// sidecar failure fails the job naming the region and keeps the features.
/** @import { TestApp } from "../support/test-app.js" */
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { extractFeatures } from "../../src/domain/extract-features.js";
import { normalize } from "../../src/domain/normalize.js";
import { unitMean } from "../../src/domain/unit-mean.js";
import { analyzeRegionJob } from "../../src/server/analyze-region-job.js";
import { decodeWithFfmpeg } from "../../src/server/decode-with-ffmpeg.js";
import { NO_CHECKPOINT_CACHE } from "../../src/server/embed-audio.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addReferenceFile, addRegion, removeRegion } from "../../src/server/reference-store.js";
import { findRegionAnalysis, putRegionFeatures } from "../../src/server/region-analysis-store.js";
import { makeReference } from "../support/reference-fixtures.js";
import { testApp } from "../support/test-app.js";

const EMBEDDER = { producer: "fake-clap@1 clap-aa", dimension: 4, ready: true };
const TARGET = -16;
/** One vector per window of the 60 s region, so their mean is known. */
const VECTORS = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [1, 1, 0, 0],
];

/** @type {TestApp} */
let made;
/** @type {string} */
let file;
/** @type {{ long: number, short: number }} */
let regions;

beforeAll(async () => {
  made = await testApp();
  const { app } = made;
  const checkpointCache = join(app.config.dataRoot, "clap");
  app.config = { ...app.config, sidecar: { ...app.config.sidecar, checkpointCache } };
  await mkdir(app.paths.references, { recursive: true });
  const sha256 = "a".repeat(64);
  const path = await makeReference(app.paths.references, "wav", { seconds: 70, seed: 3 });
  file = join(app.paths.references, `${sha256}.wav`);
  await rename(path, file);
  const { reference } = addReferenceFile(app.store, {
    sha256,
    fileName: "tone.wav",
    format: "wav",
    file: `${sha256}.wav`,
    durationSeconds: 70,
    channels: 2,
    sampleRate: 44100,
    sizeBytes: 1,
  });
  /** @param {number} startSeconds @param {number} endSeconds @param {string} label */
  const region = (startSeconds, endSeconds, label) =>
    addRegion(app.store, {
      referenceFileId: reference.id,
      startSeconds,
      endSeconds,
      label,
      note: "",
    }).id;
  regions = { long: region(5, 65, "the long one"), short: region(10, 25, "the swell") };
});
afterAll(() => made.remove());

const job = () => ({ signal: new AbortController().signal, progress: () => undefined });

/** The `audio` param of every embed_audio request the fake received, in order. */
const embeddedFiles = async () =>
  (await made.sidecar.received())
    .map(({ request }) => /** @type {{ method: string, params: { audio: string } }} */ (request))
    .filter(({ method }) => method === "embed_audio")
    .map(({ params }) => params.audio);

/** @param {number} regionId */
const stored = (regionId) =>
  findRegionAnalysis(made.app.store, { regionId, target: TARGET, producer: PRODUCER });

describe("a 60 s region", () => {
  test("is measured on four windows, each as extractFeatures reads it, and embedded as their unit mean", async () => {
    const { app, sidecar } = made;
    sidecar.script(
      { do: "answer", result: EMBEDDER },
      ...VECTORS.map((floats) => ({
        do: /** @type {const} */ ("answer"),
        result: { windows: 3 },
        floats,
      })),
    );
    const result = await analyzeRegionJob(app, { regionId: regions.long, target: TARGET })(job());
    expect(result).toEqual({
      regionId: regions.long,
      target: TARGET,
      windows: 4,
      embedded: true,
      notEmbedded: null,
    });

    const analysis = stored(regions.long);
    expect(analysis?.windows.map((w) => [w.startSeconds, w.seconds])).toEqual([
      [0, 25],
      [12.5, 25],
      [25, 25],
      [35, 25],
    ]);
    // The second window, decoded and normalized on its own, reads as stored.
    const raw = await decodeWithFfmpeg(file, 5 + 12.5, 5 + 12.5 + 25);
    const heard = normalize(raw.channels, raw.sampleRate, { target: TARGET });
    expect(analysis?.windows[1]?.features).toEqual(
      JSON.parse(JSON.stringify(extractFeatures(raw, heard))),
    );
    expect(analysis?.windows[1]?.notHeard).toBeNull();

    const expected = unitMean(VECTORS.map((v) => new Float32Array(v)));
    expect(analysis?.embeddingProducer).toBe(EMBEDDER.producer);
    expect(analysis?.embedding).toEqual(new Uint8Array(expected.buffer));
    const files = await embeddedFiles();
    expect(files).toHaveLength(4);
    for (const path of files) {
      expect(path.startsWith(app.config.dataRoot)).toBe(true);
      expect(path.endsWith(".wav")).toBe(true);
    }
  });

  test("analyzed again under the same producers, reads nothing and asks only for the embedder", async () => {
    const before = (await made.sidecar.received()).length;
    made.sidecar.script({ do: "answer", result: EMBEDDER });
    const result = await analyzeRegionJob(made.app, { regionId: regions.long, target: TARGET })(
      job(),
    );
    expect(result).toMatchObject({ windows: 4, embedded: true });
    expect((await made.sidecar.received()).length).toBe(before + 1);
  });
});

describe("a 15 s region", () => {
  test("is one window; a sidecar failure fails the job naming the region and keeps the features", async () => {
    made.sidecar.script(
      { do: "answer", result: EMBEDDER },
      { do: "error", error: "embed_audio raised ValueError: no audio" },
    );
    const run = analyzeRegionJob(made.app, { regionId: regions.short, target: TARGET })(job());
    await expect(run).rejects.toThrow(
      new RegExp(`region ${regions.short} \\(“the swell”\\).*no audio.*features are kept`),
    );
    const analysis = stored(regions.short);
    expect(analysis?.windows.map((w) => [w.startSeconds, w.seconds])).toEqual([[0, 15]]);
    expect(analysis?.embedding).toBeNull();
  });

  test("with the features kept, a second run embeds without measuring again", async () => {
    const first = stored(regions.short);
    made.sidecar.script(
      { do: "answer", result: EMBEDDER },
      { do: "answer", result: { windows: 3 }, floats: [0, 0, 3, 4] },
    );
    await analyzeRegionJob(made.app, { regionId: regions.short, target: TARGET })(job());
    const analysis = stored(regions.short);
    expect(analysis?.id).toBe(first?.id);
    expect(analysis?.embedding).toEqual(new Uint8Array(new Float32Array([0, 0, 0.6, 0.8]).buffer));
  });

  test("with no checkpoint folder, keeps the features and says why it embedded nothing", async () => {
    const { app } = made;
    const saved = app.config;
    app.config = { ...saved, sidecar: { ...saved.sidecar, checkpointCache: null } };
    try {
      const before = (await made.sidecar.received()).length;
      const result = await analyzeRegionJob(app, { regionId: regions.short, target: -20 })(job());
      expect(result).toEqual({
        regionId: regions.short,
        target: -20,
        windows: 1,
        embedded: false,
        notEmbedded: NO_CHECKPOINT_CACHE,
      });
      expect((await made.sidecar.received()).length).toBe(before);
      const analysis = findRegionAnalysis(app.store, {
        regionId: regions.short,
        target: -20,
        producer: PRODUCER,
      });
      expect(analysis?.windows).toHaveLength(1);
    } finally {
      app.config = saved;
    }
  });

  test("a row under another features producer is measured again", async () => {
    const { app } = made;
    putRegionFeatures(app.store, {
      regionId: regions.short,
      target: -18,
      producer: "engine-0 features-old",
      windows: [],
    });
    made.sidecar.script(
      { do: "answer", result: EMBEDDER },
      { do: "answer", result: { windows: 3 }, floats: [1, 0, 0, 0] },
    );
    await analyzeRegionJob(app, { regionId: regions.short, target: -18 })(job());
    const analysis = findRegionAnalysis(app.store, {
      regionId: regions.short,
      target: -18,
      producer: PRODUCER,
    });
    expect(analysis?.windows).toHaveLength(1);
  });
});

test("a removed region is refused, naming it", async () => {
  const { app } = made;
  const id = addRegion(app.store, {
    referenceFileId: 1,
    startSeconds: 0,
    endSeconds: 2,
    label: "gone",
    note: "",
  }).id;
  removeRegion(app.store, id);
  await expect(analyzeRegionJob(app, { regionId: id, target: TARGET })(job())).rejects.toThrow(
    `region ${id} was removed`,
  );
});

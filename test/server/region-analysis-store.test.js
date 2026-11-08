// Region analyses (decision 0051): derived rows found only under their producer, replaced for
// the same region and target, and migration 0009 over 0008's shape.
import { afterEach, expect, test } from "vitest";
import { addReferenceFile, addRegion } from "../../src/server/reference-store.js";
import {
  findRegionAnalysis,
  putRegionEmbedding,
  putRegionFeatures,
} from "../../src/server/region-analysis-store.js";
import { openStore, readMigrations } from "../../src/server/store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** @param {import("../../src/server/store.js").Store} store */
function region(store) {
  const { reference } = addReferenceFile(store, {
    sha256: "c".repeat(64),
    fileName: "hum.wav",
    format: "wav",
    file: `${"c".repeat(64)}.wav`,
    durationSeconds: 30,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  return addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 0,
    endSeconds: 10,
    label: "hum",
    note: "",
  });
}

test("a row is found only under its producer, and replaced for the same region and target", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const { id: regionId } = region(store);
  const old = putRegionFeatures(store, { regionId, target: -16, producer: "old", windows: [] });
  expect(findRegionAnalysis(store, { regionId, target: -16, producer: "new" })).toBeUndefined();
  putRegionEmbedding(store, old.id, { embeddingProducer: "clap", embedding: new Uint8Array(4) });
  const fresh = putRegionFeatures(store, { regionId, target: -16, producer: "new", windows: [] });
  expect(findRegionAnalysis(store, { regionId, target: -16, producer: "new" })).toEqual(fresh);
  expect(fresh.embedding).toBeNull();
  expect(store.db.prepare("SELECT count(*) AS n FROM region_analyses").get()?.n).toBe(1);
});

test("migration 0009 over a database built with 0001 to 0008 keeps its rows and adds analyses", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { paths, store: current } = made;
  current.close();
  const file = `${paths.database}-0008`;
  const migrations = readMigrations();
  const now = () => 0;
  const old = openStore(file, { now, migrations: migrations.slice(0, 8) });
  const kept = region(old);
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  expect(store.db.prepare("SELECT count(*) AS n FROM reference_regions").get()?.n).toBe(1);
  const row = putRegionFeatures(store, {
    regionId: kept.id,
    target: -16,
    producer: "p",
    windows: [],
  });
  expect(row.regionId).toBe(kept.id);
  const insert = (/** @type {string} */ values) =>
    store.db
      .prepare(
        `INSERT INTO region_analyses (regionId, target, producer, windows, embeddingProducer, embedding, createdAt)
         VALUES ${values}`,
      )
      .run();
  expect(() => insert("(999, -16, 'p', '[]', NULL, NULL, 0)")).toThrow(/FOREIGN KEY/);
  expect(() => insert(`(${kept.id}, -14, 'p', '[]', 'clap', NULL, 0)`)).toThrow(/CHECK constraint/);
  expect(() => insert(`(${kept.id}, -16, 'p', '[]', NULL, NULL, 0)`)).toThrow(/UNIQUE/);
});

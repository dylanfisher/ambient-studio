// Reference files and their regions (decision 0050): append-only rows, one live row per file's
// bytes, replacing and removing that keep the old rows, and migration 0008 over 0007's shape.
import { afterEach, expect, test } from "vitest";
import {
  addReferenceFile,
  addRegion,
  getReferenceFile,
  getRegion,
  listReferenceFiles,
  listRegions,
  REMOVED,
  removeReferenceFile,
  removeRegion,
  replaceRegion,
} from "../../src/server/reference-store.js";
import { openStore, readMigrations } from "../../src/server/store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** @param {string} digit */
const draft = (digit) => ({
  sha256: digit.repeat(64),
  fileName: "rain on a tin roof.wav",
  format: "wav",
  file: `${digit.repeat(64)}.wav`,
  durationSeconds: 120.5,
  channels: 2,
  sampleRate: 44100,
  sizeBytes: 21_258_244,
});

async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  return made;
}

test("the same bytes twice give one row, and the second upload's name is not stored", async () => {
  const { store, reopen } = await setup();
  const first = addReferenceFile(store, draft("a"));
  expect(first.added).toBe(true);
  const again = addReferenceFile(reopen(), { ...draft("a"), fileName: "copy.wav" });
  expect(again).toEqual({ reference: first.reference, added: false });
  expect(listReferenceFiles(reopen()).map((row) => row.fileName)).toEqual([
    "rain on a tin roof.wav",
  ]);
});

test("a removed file keeps its row, and the same bytes uploaded again make a new one", async () => {
  const { store } = await setup();
  const { reference } = addReferenceFile(store, draft("b"));
  const region = addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 1,
    endSeconds: 4,
    label: "hiss",
    note: "",
  });
  removeReferenceFile(store, reference.id);
  expect(listReferenceFiles(store)).toEqual([]);
  expect(getReferenceFile(store, reference.id)?.removedReason).toBe(REMOVED.removed);
  // Its live regions go with it, so nothing reads a region of a removed file.
  expect(getRegion(store, region.id)?.removedReason).toBe(REMOVED.fileRemoved);
  const again = addReferenceFile(store, draft("b"));
  expect(again.added).toBe(true);
  expect(again.reference.id).not.toBe(reference.id);
});

test("replacing a region marks it replaced and adds its successor; removing keeps the row", async () => {
  const { store } = await setup();
  const { reference } = addReferenceFile(store, draft("c"));
  const region = addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 10,
    endSeconds: 40,
    label: "the swell",
    note: "slow rise",
  });
  const next = replaceRegion(store, region.id, {
    startSeconds: 12,
    endSeconds: 38,
    label: "the swell",
    note: "slow rise, no click",
  });
  expect(next).toMatchObject({ replacesId: region.id, startSeconds: 12, removedAt: null });
  expect(getRegion(store, region.id)).toMatchObject({
    startSeconds: 10,
    removedReason: REMOVED.replaced,
  });
  expect(listRegions(store, reference.id).map((row) => row.id)).toEqual([next.id]);
  removeRegion(store, next.id);
  expect(listRegions(store, reference.id)).toEqual([]);
  expect(getRegion(store, next.id)?.removedReason).toBe(REMOVED.removed);
  expect(() => replaceRegion(store, next.id, { ...next })).toThrow(/removed/);
});

test("both tables are append-only", async () => {
  const { store } = await setup();
  const { reference } = addReferenceFile(store, draft("d"));
  const region = addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 0,
    endSeconds: 2,
    label: "a",
    note: "",
  });
  const run = (/** @type {string} */ sql, /** @type {number} */ id) =>
    store.db.prepare(sql).run(id);
  expect(() => run("DELETE FROM reference_files WHERE id = ?", reference.id)).toThrow(
    /append-only/,
  );
  expect(() => run("UPDATE reference_files SET fileName = 'x' WHERE id = ?", reference.id)).toThrow(
    /append-only/,
  );
  expect(() => run("DELETE FROM reference_regions WHERE id = ?", region.id)).toThrow(/append-only/);
  expect(() => run("UPDATE reference_regions SET endSeconds = 3 WHERE id = ?", region.id)).toThrow(
    /append-only/,
  );
});

test("migration 0008 over a database built with 0001 to 0007 keeps its rows and adds references", async () => {
  const { paths, now } = await setup();
  const file = `${paths.database}-0007`;
  const migrations = readMigrations();
  const old = openStore(file, { now, migrations: migrations.slice(0, 7) });
  old.db.prepare("INSERT INTO vibes (id, createdAt) VALUES (1, 0)").run();
  old.db
    .prepare("INSERT INTO evaluations (params, report, createdAt) VALUES ('{}', '{}', 0)")
    .run();
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  expect(store.db.prepare("SELECT count(*) AS n FROM vibes").get()?.n).toBe(1);
  expect(store.db.prepare("SELECT count(*) AS n FROM evaluations").get()?.n).toBe(1);
  const { reference } = addReferenceFile(store, draft("e"));
  expect(listReferenceFiles(store)).toEqual([reference]);
  const insert = (/** @type {string} */ values) =>
    store.db
      .prepare(
        `INSERT INTO reference_regions (referenceFileId, startSeconds, endSeconds, label, note, createdAt)
         VALUES ${values}`,
      )
      .run();
  expect(() => insert(`(${reference.id}, 5, 5, 'empty', '', 0)`)).toThrow(/CHECK constraint/);
  expect(() => insert(`(${reference.id}, -1, 5, 'before', '', 0)`)).toThrow(/CHECK constraint/);
  expect(() => insert("(999, 1, 5, 'no file', '', 0)")).toThrow(/FOREIGN KEY/);
  const channels = `INSERT INTO reference_files (sha256, fileName, format, file, durationSeconds,
    channels, sampleRate, sizeBytes, createdAt) VALUES ('${"f".repeat(64)}', 'x', 'wav', 'x.wav',
    20, 4, 48000, 10, 0)`;
  expect(() => store.db.prepare(channels).run()).toThrow(/CHECK constraint/);
});

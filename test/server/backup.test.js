// The backup: VACUUM INTO a dated folder, with the rated-audio folder copied beside it
// (decision 0021).
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { backup } from "../../src/server/backup.js";
import { openStore } from "../../src/server/store.js";
import { addNote } from "../../src/server/vibe-store.js";
import { fillStore, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const WHEN = new Date(Date.UTC(2026, 10, 6, 21, 4, 5, 678));

/**
 * Every row of every table, by table.
 * @param {DatabaseSync} db
 */
function everything(db) {
  const names = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(
    names.map((name) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]),
  );
}

test("a backup opens with the same rows while a writer holds the WAL", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store, paths, now } = made;
  const ids = fillStore(store);
  await mkdir(paths.ratedAudio);
  await writeFile(join(paths.ratedAudio, "drone-7.flac"), "flac bytes");
  // The committed rows are still in the WAL, not yet checkpointed into the database file.
  expect((await stat(`${paths.database}-wal`)).size).toBeGreaterThan(0);
  const committed = everything(store.db);

  const writer = new DatabaseSync(paths.database);
  cleanups.push(async () => writer.close());
  writer.exec("BEGIN IMMEDIATE");
  writer
    .prepare("INSERT INTO notes (vibeId, text, createdAt) VALUES (?, 'uncommitted', 0)")
    .run(ids.vibes);

  const written = await backup(paths, WHEN);
  expect(written.folder).toBe(join(paths.backups, "2026-11-06T21-04-05Z"));
  writer.exec("ROLLBACK");

  const copy = openStore(written.database, { now });
  cleanups.push(async () => copy.close());
  expect(everything(copy.db)).toEqual(committed);
  expect(await readFile(join(written.ratedAudio, "drone-7.flac"), "utf8")).toBe("flac bytes");
  // The copy is a database of its own: a write to it leaves the original alone.
  addNote(copy, { vibeId: ids.vibes, text: "only in the copy" });
  expect(everything(store.db)).toEqual(committed);
});

test("a second backup in the same second is refused", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const first = await backup(made.paths, WHEN);
  expect(existsSync(first.database)).toBe(true);
  await expect(backup(made.paths, WHEN)).rejects.toThrow(/EEXIST/);
});

test("a backup with nothing rated yet writes an empty rated-audio folder", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { ratedAudio } = await backup(made.paths, WHEN);
  expect((await stat(ratedAudio)).isDirectory()).toBe(true);
});

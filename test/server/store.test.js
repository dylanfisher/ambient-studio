// The store's migrations and its append-only triggers (decision 0021).
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { markRemoved, openStore, readMigrations } from "../../src/server/store.js";
import { fillStore, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function made() {
  const made = await tempStore();
  cleanups.push(made.remove);
  return made;
}

const APPEND_ONLY = /append-only/;

/**
 * @param {DatabaseSync} db
 * @param {string} sql
 * @param {import("node:sqlite").SQLInputValue[]} params
 */
const run = (db, sql, ...params) => db.prepare(sql).run(...params);

/** @param {DatabaseSync} db */
function tables(db) {
  const rows = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
  return rows.map((row) => String(row.name)).filter((name) => !name.startsWith("sqlite_"));
}

/**
 * @param {DatabaseSync} db
 * @param {string} table
 */
function columns(db, table) {
  return db
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(table)
    .map((row) => String(row.name));
}

/**
 * A migration numbered after the real ones.
 * @param {string} slug
 * @param {string} sql
 */
function extra(slug, sql) {
  const id = readMigrations().length + 1;
  return { id, name: `${String(id).padStart(4, "0")}-${slug}`, sql };
}

/**
 * The message of the cause of the error `fn` throws.
 * @param {() => unknown} fn
 */
function causeOf(fn) {
  try {
    fn();
  } catch (error) {
    return /** @type {Error} */ (/** @type {Error} */ (error).cause).message;
  }
  throw new Error("it didn't throw");
}

/** Tables that aren't irreplaceable: the migration log and the derived tables. */
const NOT_IRREPLACEABLE = ["migrations", "renders", "embeddings", "region_analyses"];

describe("migrations", () => {
  test("build an empty database, and a second open applies nothing", async () => {
    const { store, reopen } = await made();
    const migrations = readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    /** @param {DatabaseSync} db */
    const applied = (db) =>
      db
        .prepare("SELECT id, name, appliedAt FROM migrations ORDER BY id")
        .all()
        .map((row) => ({ ...row }));
    /** @param {DatabaseSync} db */
    const schema = (db) =>
      db
        .prepare("SELECT sql FROM sqlite_schema ORDER BY name")
        .all()
        .map((row) => row.sql);
    const first = applied(store.db);
    expect(first.map(({ id, name }) => ({ id, name }))).toEqual(
      migrations.map(({ id, name }) => ({ id, name })),
    );
    const before = schema(store.db);
    const reopened = reopen();
    expect(applied(reopened.db)).toEqual(first);
    expect(schema(reopened.db)).toEqual(before);
  });

  test("open in WAL mode with foreign keys and recursive triggers on", async () => {
    const { store } = await made();
    expect(store.db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(store.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(store.db.prepare("PRAGMA recursive_triggers").get()?.recursive_triggers).toBe(1);
  });

  test("a failed migration leaves nothing behind and throws its name", async () => {
    const { paths, now } = await made();
    const file = `${paths.database}-broken`;
    const migrations = [
      ...readMigrations(),
      extra("broken", "CREATE TABLE half (id INTEGER PRIMARY KEY); nonsense;"),
    ];
    expect(() => openStore(file, { now, migrations })).toThrow(/-broken failed/);
    const db = new DatabaseSync(file);
    expect(tables(db)).not.toContain("half");
    expect(db.prepare("SELECT max(id) AS id FROM migrations").get()?.id).toBe(
      readMigrations().at(-1)?.id,
    );
    db.close();
  });

  test("refuse a table that is neither irreplaceable nor listed as derived", async () => {
    const { paths, now } = await made();
    const migrations = [
      ...readMigrations(),
      extra("loose", "CREATE TABLE loose (id INTEGER PRIMARY KEY) STRICT;"),
    ];
    const open = () => openStore(`${paths.database}-loose`, { now, migrations });
    expect(open).toThrow(/-loose failed/);
    expect(causeOf(open)).toMatch(/loose has no removedAt/);
  });

  test("refuse a database that has a migration this code doesn't know", async () => {
    const { store, paths, now } = await made();
    run(
      store.db,
      "INSERT INTO migrations (id, name, sha256, appliedAt) VALUES (999, '0999-future', '', 0)",
    );
    store.close();
    expect(() => openStore(paths.database, { now })).toThrow(/0999-future/);
  });

  test("refuse a migration whose text changed after it was applied, naming it", async () => {
    const { store, paths, now } = await made();
    store.close();
    const [first, ...rest] = readMigrations();
    if (!first) throw new Error("no migrations");
    const edited = [{ ...first, sql: `${first.sql}\n-- edited\n` }, ...rest];
    expect(() => openStore(paths.database, { now, migrations: edited })).toThrow(
      new RegExp(`${first.name}\\.sql .*changed`),
    );
  });

  test("a migration that adds a column covers it with the update trigger", async () => {
    const { store, paths, now } = await made();
    const { notes } = fillStore(store);
    store.close();
    const migrations = [
      ...readMigrations(),
      extra("mood", "ALTER TABLE notes ADD COLUMN mood TEXT;"),
    ];
    const reopened = openStore(paths.database, { now, migrations });
    cleanups.push(async () => reopened.close());
    const sql = "UPDATE notes SET mood = 'calm', removedAt = 1, removedReason = 'r' WHERE id = ?";
    expect(() => run(reopened.db, sql, notes)).toThrow(APPEND_ONLY);
  });

  test("two processes opening one new database both succeed and apply each migration once", async () => {
    const { paths } = await made();
    const file = `${paths.database}-shared`;
    const go = `${paths.database}-go`;
    const storeUrl = new URL("../../src/server/store.js", import.meta.url).href;
    // Each child says it's ready, waits for the go file, then opens the store, so both opens
    // start together.
    const code = `
      import { existsSync } from "node:fs";
      import { openStore } from ${JSON.stringify(storeUrl)};
      console.log("ready");
      const pause = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(${JSON.stringify(go)})) Atomics.wait(pause, 0, 0, 1);
      openStore(${JSON.stringify(file)}, { now: Date.now }).close();
    `;
    const children = [0, 1].map(() =>
      spawn(process.execPath, ["--input-type=module", "-e", code], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    /** @type {string[]} */
    const errors = children.map(() => "");
    children.forEach((child, i) => {
      child.stderr.on("data", (chunk) => {
        errors[i] += chunk;
      });
    });
    await Promise.all(children.map((child) => once(child.stdout, "data")));
    await writeFile(go, "");
    const codes = await Promise.all(children.map(async (child) => (await once(child, "close"))[0]));
    expect({ codes, errors }).toEqual({ codes: [0, 0], errors: ["", ""] });
    const db = new DatabaseSync(file);
    cleanups.push(async () => db.close());
    const applied = db.prepare("SELECT id FROM migrations ORDER BY id").all();
    expect(applied.map((row) => row.id)).toEqual(readMigrations().map(({ id }) => id));
  });

  test("refuse migration files numbered out of order", async () => {
    const { paths, now } = await made();
    const [first] = readMigrations();
    if (!first) throw new Error("no migrations");
    const migrations = [{ ...first, id: 2 }];
    expect(() => openStore(`${paths.database}-misnumbered`, { now, migrations })).toThrow(
      /numbered 1, 2, 3/,
    );
  });
});

describe("append-only tables", () => {
  test("every irreplaceable table has its triggers and a row from fillStore", async () => {
    const { store } = await made();
    const ids = fillStore(store);
    const irreplaceable = tables(store.db).filter((name) => !NOT_IRREPLACEABLE.includes(name));
    expect(Object.keys(ids).sort()).toEqual(irreplaceable.sort());
    const triggers = store.db
      .prepare("SELECT tbl_name AS tableName, name FROM sqlite_schema WHERE type = 'trigger'")
      .all()
      .map((row) => `${row.tableName}.${row.name}`);
    for (const table of irreplaceable) {
      expect(triggers).toContain(`${table}.${table}_no_delete`);
      expect(triggers).toContain(`${table}.${table}_no_update`);
    }
  });

  test("DELETE raises on every irreplaceable table", async () => {
    const { store } = await made();
    for (const [table, id] of Object.entries(fillStore(store))) {
      expect(() => run(store.db, `DELETE FROM ${table} WHERE id = ?`, id), table).toThrow(
        APPEND_ONLY,
      );
    }
  });

  test("an UPDATE of any column but removedAt and removedReason raises", async () => {
    const { store } = await made();
    for (const [table, id] of Object.entries(fillStore(store))) {
      for (const column of columns(store.db, table)) {
        if (column === "removedAt" || column === "removedReason") continue;
        // A value that differs from the current one whatever it is, null included. The id is a
        // rowid, which refuses null before any trigger runs.
        const other =
          column === "id" ? "id + 1000" : `CASE WHEN "${column}" IS NULL THEN 1 ELSE NULL END`;
        // Alongside a valid removal, so only the column's own change can trip the trigger.
        const sql = `UPDATE ${table} SET "${column}" = ${other}, removedAt = 1, removedReason = 'r' WHERE id = ?`;
        expect(() => run(store.db, sql, id), `${table}.${column}`).toThrow(APPEND_ONLY);
      }
      const unchanged = `SELECT removedAt FROM ${table} WHERE id = ?`;
      expect(store.db.prepare(unchanged).get(id)?.removedAt, table).toBeNull();
    }
  });

  test("INSERT OR REPLACE over an existing row raises", async () => {
    const { store } = await made();
    const { notes } = fillStore(store);
    const sql =
      "INSERT OR REPLACE INTO notes (id, vibeId, text, createdAt) SELECT id, vibeId, 'other', createdAt FROM notes WHERE id = ?";
    expect(() => run(store.db, sql, notes)).toThrow(APPEND_ONLY);
  });

  test("marking a row removed works once, and a second time raises", async () => {
    const { store, reopen } = await made();
    const { notes } = fillStore(store);
    markRemoved(store, "notes", notes, "duplicate");
    const row = reopen().db.prepare("SELECT removedAt, removedReason FROM notes").get();
    expect({ ...row }).toEqual({ removedAt: expect.any(Number), removedReason: "duplicate" });
    const again = () => markRemoved(reopen(), "notes", notes, "again");
    expect(again).toThrow(APPEND_ONLY);
  });

  test("marking removed refuses a missing row, an empty reason and a derived table", async () => {
    const { store } = await made();
    const { notes } = fillStore(store);
    expect(() => markRemoved(store, "notes", notes + 1, "gone")).toThrow(/no row/);
    expect(() => markRemoved(store, "notes", notes, "")).toThrow(/reason/);
    expect(() => markRemoved(store, /** @type {any} */ ("renders"), 1, "x")).toThrow(
      /irreplaceable/,
    );
  });

  test("setting removedAt back to null raises", async () => {
    const { store } = await made();
    const { notes } = fillStore(store);
    markRemoved(store, "notes", notes, "duplicate");
    const sql = "UPDATE notes SET removedAt = NULL WHERE id = ?";
    expect(() => run(store.db, sql, notes)).toThrow(APPEND_ONLY);
  });

  test("an update that sets removedAt without a reason raises", async () => {
    const { store } = await made();
    const { notes } = fillStore(store);
    const sql = "UPDATE notes SET removedAt = 1 WHERE id = ?";
    expect(() => run(store.db, sql, notes)).toThrow(APPEND_ONLY);
  });
});

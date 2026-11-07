// The SQLite store (decision 0021): opening, migrations, the append-only triggers, and the row
// helpers the table files (vibe-store.js and its neighbors) build on. SQL lives only here, in
// those files and in migrations/.
/** @import { SQLInputValue, SQLOutputValue } from "node:sqlite" */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "./sha256-hex.js";

/**
 * @typedef {object} Store
 * @property {DatabaseSync} db
 * @property {() => number} now milliseconds since the Unix epoch, for `createdAt` and
 *   `removedAt`
 * @property {() => void} close
 */

/**
 * @typedef {object} Migration
 * @property {number} id the file's number
 * @property {string} name the file's name without `.sql`
 * @property {string} sql
 */

/**
 * The columns every irreplaceable row has.
 * @typedef {object} Removable
 * @property {number | null} removedAt
 * @property {string | null} removedReason
 */

/** Every table the migrations make, by the name the JS uses. */
export const TABLE = /** @type {const} */ ({
  vibes: "vibes",
  vibeRevisions: "vibe_revisions",
  notes: "notes",
  sessionEvents: "session_events",
  generations: "generations",
  genomes: "genomes",
  candidates: "candidates",
  ratedAudio: "rated_audio",
  ratings: "ratings",
  feedback: "feedback",
  sketches: "sketches",
  evaluations: "evaluations",
  locks: "locks",
  renders: "renders",
  embeddings: "embeddings",
});

/**
 * @typedef {Exclude<(typeof TABLE)[keyof typeof TABLE], typeof TABLE.renders | typeof TABLE.embeddings>}
 *   IrreplaceableTable
 */

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");
/**
 * How long a connection waits for another's write lock before failing: two processes opening
 * the store at once, or the backup's read beside a writer, wait rather than fail.
 */
const BUSY_TIMEOUT_MS = 5000;
const MIGRATION_FILE = /^(\d{4})-[a-z0-9-]+\.sql$/;

/**
 * Tables without the append-only triggers: the migration log, and derived tables, which are
 * deleted and rebuilt (AGENTS.md). Every other table must have removedAt and removedReason.
 */
const NOT_APPEND_ONLY = new Set(["migrations", TABLE.renders, TABLE.embeddings]);
const REMOVED_AT = "removedAt";
const REMOVED_REASON = "removedReason";

/**
 * The migrations in `src/server/migrations/`, in order.
 * @returns {Migration[]}
 */
export function readMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match) throw new Error(`migration ${file} isn't named NNNN-slug.sql`);
      return {
        id: Number(match[1]),
        name: file.slice(0, -".sql".length),
        sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
      };
    });
}

/** @param {string} name */
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

/**
 * Runs `fn` in an immediate transaction: committed when it returns, rolled back when it throws.
 * @template T
 * @param {Store} store
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(store, fn) {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    store.db.exec("COMMIT");
    return result;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * @param {DatabaseSync} db
 * @returns {string[]}
 */
function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name));
}

/**
 * @param {DatabaseSync} db
 * @param {string} table
 * @returns {string[]}
 */
function columnNames(db, table) {
  return db
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(table)
    .map((row) => String(row.name));
}

/**
 * Drops every table's append-only triggers, so a migration may rewrite rows; `addTriggers` puts
 * them back in the same transaction.
 * @param {DatabaseSync} db
 */
function dropTriggers(db) {
  for (const table of tableNames(db)) {
    for (const suffix of ["no_delete", "no_update"]) {
      db.exec(`DROP TRIGGER IF EXISTS ${quote(`${table}_${suffix}`)}`);
    }
  }
}

/**
 * Creates the append-only triggers on every table but the ones in NOT_APPEND_ONLY, from the
 * table's columns as they are now, so a column a migration adds is covered.
 * @param {DatabaseSync} db
 */
function addTriggers(db) {
  for (const table of tableNames(db)) {
    if (NOT_APPEND_ONLY.has(table)) continue;
    const columns = columnNames(db, table);
    if (!columns.includes(REMOVED_AT) || !columns.includes(REMOVED_REASON)) {
      throw new Error(
        `table ${table} has no ${REMOVED_AT} or ${REMOVED_REASON}: an irreplaceable table needs both, and a derived one is listed in NOT_APPEND_ONLY in store.js`,
      );
    }
    const changed = columns
      .filter((column) => column !== REMOVED_AT && column !== REMOVED_REASON)
      .map((column) => `NEW.${quote(column)} IS NOT OLD.${quote(column)}`);
    const t = quote(table);
    db.exec(`CREATE TRIGGER ${quote(`${table}_no_delete`)} BEFORE DELETE ON ${t}
      BEGIN SELECT RAISE(ABORT, '${table} is append-only: mark the row removed instead'); END`);
    db.exec(`CREATE TRIGGER ${quote(`${table}_no_update`)} BEFORE UPDATE ON ${t}
      WHEN OLD.${REMOVED_AT} IS NOT NULL OR NEW.${REMOVED_AT} IS NULL
        OR NEW.${REMOVED_REASON} IS NULL OR ${changed.join(" OR ")}
      BEGIN SELECT RAISE(ABORT, '${table} is append-only: an update may only set ${REMOVED_AT} and ${REMOVED_REASON}, once'); END`);
  }
}

/**
 * How many migrations the database has applied. Throws on one this code doesn't have, and on
 * one whose file has changed since it was applied.
 * @param {DatabaseSync} db
 * @param {Migration[]} migrations
 */
function appliedCount(db, migrations) {
  const applied = db.prepare("SELECT id, name, sha256 FROM migrations ORDER BY id").all();
  for (const row of applied) {
    const known = migrations[Number(row.id) - 1];
    if (!known || known.name !== row.name) {
      throw new Error(
        `the database has applied migration ${row.name}, which this code doesn't have; it was written by a newer version`,
      );
    }
    const now = sha256Hex(known.sql);
    if (now !== row.sha256) {
      throw new Error(
        `migration ${known.name}.sql has changed since this database applied it (SHA-256 ${row.sha256} then, ${now} now). An applied migration is never edited: restore the file and put the change in a new migration`,
      );
    }
  }
  return applied.length;
}

/**
 * Applies the migrations a database hasn't had, each in its own transaction with the triggers
 * rebuilt after it. The applied list is read inside that transaction, so two processes opening
 * a new database can't both apply one. Throws on migrations not numbered 1, 2, 3…, and as
 * `appliedCount` does.
 * @param {DatabaseSync} db
 * @param {Migration[]} migrations
 * @param {() => number} now
 */
function migrate(db, migrations, now) {
  for (const [index, migration] of migrations.entries()) {
    if (migration.id !== index + 1) {
      throw new Error(
        `migrations must be numbered 1, 2, 3… with no gaps; ${migration.name} is number ${index + 1}`,
      );
    }
  }
  for (;;) {
    db.exec("BEGIN IMMEDIATE");
    /** @type {Migration | undefined} */
    let migration;
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        sha256 TEXT NOT NULL, appliedAt INTEGER NOT NULL) STRICT`);
      migration = migrations[appliedCount(db, migrations)];
      if (!migration) {
        db.exec("COMMIT");
        return;
      }
      dropTriggers(db);
      db.exec(migration.sql);
      addTriggers(db);
      db.prepare("INSERT INTO migrations (id, name, sha256, appliedAt) VALUES (?, ?, ?, ?)").run(
        migration.id,
        migration.name,
        sha256Hex(migration.sql),
        now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (!migration) throw error;
      throw new Error(`migration ${migration.name} failed and was rolled back`, { cause: error });
    }
  }
}

/** Times `useWal` waits out another connection switching a new file to WAL. */
const WAL_ATTEMPTS = 3;

/**
 * Switches the database to WAL mode, which stays set in the file.
 * @param {DatabaseSync} db
 */
function useWal(db) {
  for (let attempt = 1; ; attempt++) {
    try {
      const mode = db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode;
      if (mode !== "wal") throw new Error(`the database stayed in journal mode ${mode}, not WAL`);
      return;
    } catch (error) {
      // When another connection is switching a new file at the same moment, SQLite fails this
      // at once instead of using the busy timeout. Taking and releasing the write lock waits,
      // with the timeout, until the other connection is done.
      const locked = /database is locked/.test(/** @type {Error} */ (error).message);
      if (!locked || attempt === WAL_ATTEMPTS) throw error;
      db.exec("BEGIN IMMEDIATE");
      db.exec("COMMIT");
    }
  }
}

/**
 * @typedef {object} OpenOptions
 * @property {() => number} now
 * @property {Migration[]} [migrations] the ones in `src/server/migrations/` when omitted; tests
 *   pass others
 */

/**
 * Opens the database at `file`, creating it when missing, in WAL mode with foreign keys on, and
 * applies any migrations it hasn't had.
 * @param {string} file
 * @param {OpenOptions} options
 * @returns {Store}
 */
export function openStore(file, { now, migrations = readMigrations() }) {
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    useWal(db);
    db.exec("PRAGMA foreign_keys = ON");
    // Without this, INSERT OR REPLACE deletes the row it replaces without firing the delete
    // trigger.
    db.exec("PRAGMA recursive_triggers = ON");
    migrate(db, migrations, now);
  } catch (error) {
    db.close();
    throw error;
  }
  return { db, now, close: () => db.close() };
}

/**
 * Writes a consistent copy of the database at `file` to `dest` with `VACUUM INTO`, from a
 * read-only connection, so it neither migrates the source nor waits for its writers.
 * @param {string} file
 * @param {string} dest must not exist
 */
export function backupDatabase(file, dest) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  try {
    db.prepare("VACUUM INTO ?").run(dest);
  } finally {
    db.close();
  }
}

/**
 * Marks an irreplaceable row removed. Throws when the row doesn't exist, and, from the trigger,
 * when it was already removed.
 * @param {Store} store
 * @param {IrreplaceableTable} table
 * @param {number} id
 * @param {string} reason
 */
export function markRemoved(store, table, id, reason) {
  if (NOT_APPEND_ONLY.has(table) || !Object.values(TABLE).includes(table)) {
    throw new Error(`${table} isn't an irreplaceable table`);
  }
  if (reason.trim() === "") throw new Error("a removal needs a reason");
  const { changes } = store.db
    .prepare(`UPDATE ${quote(table)} SET ${REMOVED_AT} = ?, ${REMOVED_REASON} = ? WHERE id = ?`)
    .run(store.now(), reason, id);
  if (changes !== 1) throw new Error(`${table} has no row ${id}`);
}

/** @typedef {Record<string, SQLOutputValue>} Row */

/**
 * How a table's JS values map to its columns: `json` columns hold JSON text, `boolean` columns
 * 0 or 1. Every other value is stored as it is.
 * @typedef {object} Codec
 * @property {readonly string[]} [json]
 * @property {readonly string[]} [boolean]
 */

/**
 * @param {Codec} codec
 * @param {Record<string, unknown>} values
 * @returns {Record<string, SQLInputValue>}
 */
function encode({ json = [], boolean = [] }, values) {
  return Object.fromEntries(
    Object.entries(values).map(([column, value]) => {
      if (value === undefined) throw new Error(`${column} is undefined; store null instead`);
      if (value === null) return [column, null];
      if (json.includes(column)) return [column, JSON.stringify(value)];
      if (boolean.includes(column)) return [column, value ? 1 : 0];
      return [column, /** @type {SQLInputValue} */ (value)];
    }),
  );
}

/**
 * A row as a plain object, JSON parsed and booleans restored.
 * @template T
 * @param {Codec} codec
 * @param {Row} row
 * @returns {T}
 */
export function decode({ json = [], boolean = [] }, row) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null) out[column] = null;
    else if (json.includes(column)) out[column] = JSON.parse(String(value));
    else if (boolean.includes(column)) out[column] = value === 1;
    else out[column] = value;
  }
  return /** @type {T} */ (out);
}

/**
 * Inserts a row and returns it as stored. The store sets `createdAt`, and the database the id;
 * an unknown key fails as an unknown column.
 * @template T
 * @param {Store} store
 * @param {string} table
 * @param {Codec} codec
 * @param {Record<string, unknown>} values
 * @returns {T}
 */
export function insertRow(store, table, codec, values) {
  const encoded = encode(codec, { ...values, createdAt: store.now() });
  const columns = Object.keys(encoded);
  const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")})
    VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`;
  const row = store.db.prepare(sql).get(...Object.values(encoded));
  if (!row) throw new Error(`inserting into ${table} returned no row`);
  return decode(codec, row);
}

/**
 * Rows of `table` whose columns equal `where`, in id order. Removed rows are left out unless
 * `includeRemoved` is set; a table without removedAt has none.
 * @template T
 * @param {Store} store
 * @param {string} table
 * @param {Codec} codec
 * @param {Record<string, SQLInputValue>} where
 * @param {{ includeRemoved?: boolean }} [options]
 * @returns {T[]}
 */
export function selectRows(store, table, codec, where, { includeRemoved = false } = {}) {
  const terms = Object.keys(where).map((column) => `${quote(column)} = ?`);
  if (!includeRemoved) terms.push(`${REMOVED_AT} IS NULL`);
  const clause = terms.length > 0 ? `WHERE ${terms.join(" AND ")}` : "";
  const sql = `SELECT * FROM ${quote(table)} ${clause} ORDER BY id`;
  return store.db
    .prepare(sql)
    .all(...Object.values(where))
    .map((row) => decode(codec, row));
}

/**
 * The row with `id`, removed or not, or undefined.
 * @template T
 * @param {Store} store
 * @param {string} table
 * @param {Codec} codec
 * @param {number} id
 * @returns {T | undefined}
 */
export function selectRow(store, table, codec, id) {
  return selectRows(store, table, codec, { id }, { includeRemoved: true })[0];
}

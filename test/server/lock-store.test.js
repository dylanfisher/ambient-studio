// A vibe's locks (decision 0035): append-only rows, one live lock per path, a whole voice
// covering the locks inside it, and migration 0004 over the shape before it.
import { afterEach, expect, test } from "vitest";
import {
  getLock,
  listLocks,
  locksInForce,
  removeLock,
  setLock,
} from "../../src/server/lock-store.js";
import { openStore, readMigrations } from "../../src/server/store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { fillStore, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A store with every table filled, so a candidate exists to lock values from. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const ids = fillStore(made.store);
  const lock = (
    /** @type {string} */ path,
    /** @type {unknown} */ value,
    /** @type {string | null} */ voiceType = null,
  ) =>
    setLock(made.store, { vibeId: ids.vibes, candidateId: ids.candidates, path, value, voiceType });
  return { ...made, ids, lock };
}

test("a lock reads back equal after a reopen, and its vibe lists it", async () => {
  const { reopen, ids, lock } = await setup();
  const before = listLocks(reopen(), ids.vibes);
  const { lock: hold, removed } = lock("voices.drone.cutoff", { points: [[0, 300]] }, "drone");
  expect(removed).toEqual([]);
  const store = reopen();
  expect(getLock(store, hold.id)).toEqual(hold);
  expect(listLocks(store, ids.vibes)).toEqual([...before, hold]);
  expect(locksInForce(store, ids.vibes).at(-1)).toEqual({
    path: "voices.drone.cutoff",
    value: { points: [[0, 300]] },
    voiceType: "drone",
  });
});

test("a flag and a number keep their JSON types", async () => {
  const { store, ids, lock } = await setup();
  lock("voices.fx.snap", false, "fixture");
  lock("reverbDecay", 8);
  expect(locksInForce(store, ids.vibes).slice(-2)).toEqual([
    { path: "voices.fx.snap", value: false, voiceType: "fixture" },
    { path: "reverbDecay", value: 8 },
  ]);
});

test("locking a live path again marks the old row replaced", async () => {
  const { store, ids, lock } = await setup();
  const first = lock("reverbDecay", 8).lock;
  const { lock: second, removed } = lock("reverbDecay", 10);
  expect(removed.map((row) => row.id)).toEqual([first.id]);
  expect(getLock(store, first.id)).toMatchObject({
    removedAt: expect.any(Number),
    removedReason: "replaced",
  });
  expect(listLocks(store, ids.vibes).filter((row) => row.path === "reverbDecay")).toEqual([second]);
});

test("locking a whole voice marks the live locks inside it covered", async () => {
  const { store, lock } = await setup();
  const level = lock("voices.drone.level", -8, "drone").lock;
  const cutoff = lock("voices.drone.cutoff", 400, "drone").lock;
  const other = lock("voices.dronex.level", -8, "drone").lock;
  const { removed } = lock("voices.drone", { id: "drone", type: "drone" });
  expect(removed.map((row) => row.id)).toEqual([level.id, cutoff.id]);
  for (const id of [level.id, cutoff.id]) {
    expect(getLock(store, id)?.removedReason).toBe("covered");
  }
  expect(getLock(store, other.id)?.removedAt).toBeNull();
});

test("locking a path inside a locked voice is refused", async () => {
  const { store, ids, lock } = await setup();
  lock("voices.drone", { id: "drone", type: "drone" });
  const count = listLocks(store, ids.vibes).length;
  expect(() => lock("voices.drone.level", -8, "drone")).toThrow(
    /voices\.drone\.level is inside voices\.drone, which is locked whole/,
  );
  expect(listLocks(store, ids.vibes)).toHaveLength(count);
});

test("a removed lock leaves the live list and keeps its row", async () => {
  const { store, ids, lock } = await setup();
  const made = lock("reverbDecay", 8).lock;
  const removed = removeLock(store, made.id);
  expect(removed).toMatchObject({ id: made.id, removedReason: "unlocked" });
  expect(listLocks(store, ids.vibes).map((row) => row.id)).not.toContain(made.id);
  expect(getLock(store, made.id)).toEqual(removed);
  // A second remove leaves it as it is.
  expect(removeLock(store, made.id)).toEqual(removed);
  expect(() => removeLock(store, made.id + 100)).toThrow(/there is no lock/);
});

test("another vibe's locks aren't listed", async () => {
  const { store, ids, lock } = await setup();
  lock("reverbDecay", 8);
  const other = createVibe(store, { name: "o", brief: "b", constraints: {}, softTargets: {} });
  expect(listLocks(store, other.id)).toEqual([]);
  expect(listLocks(store, ids.vibes).length).toBeGreaterThan(0);
});

test("migration 0004 over a database built with 0001 to 0003 keeps its rows and adds locks", async () => {
  const { paths, now } = await setup();
  const file = `${paths.database}-0003`;
  const migrations = readMigrations();
  const old = openStore(file, { now, migrations: migrations.slice(0, 3) });
  const run = (/** @type {string} */ sql) => old.db.prepare(sql).run();
  run("INSERT INTO vibes (id, createdAt) VALUES (1, 0)");
  run(
    `INSERT INTO vibe_revisions (id, vibeId, name, brief, constraints, softTargets, createdAt)
     VALUES (1, 1, 'v', 'b', '{}', '{}', 0)`,
  );
  run(
    `INSERT INTO candidates (id, vibeRevisionId, seed, source, parentIds, locks, createdAt)
     VALUES (1, 1, 3, 'llm', '[]', '[]', 0)`,
  );
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  expect(store.db.prepare("SELECT count(*) AS n FROM candidates").get()?.n).toBe(1);
  const { lock } = setLock(store, {
    vibeId: 1,
    candidateId: 1,
    path: "reverbDecay",
    value: 8,
    voiceType: null,
  });
  expect(listLocks(store, 1)).toEqual([lock]);
  // One live lock per path, whatever the caller does.
  const twin = `INSERT INTO locks (vibeId, candidateId, path, value, createdAt)
    VALUES (1, 1, 'reverbDecay', '9', 0)`;
  expect(() => store.db.prepare(twin).run()).toThrow(/UNIQUE constraint/);
  // A lock names a vibe and a candidate that exist.
  const orphan = `INSERT INTO locks (vibeId, candidateId, path, value, createdAt)
    VALUES (1, 99, 'width', '-3', 0)`;
  expect(() => store.db.prepare(orphan).run()).toThrow(/FOREIGN KEY/);
});

// Hiding candidates (decision 0049): one append-only row per hide or unhide, the newest row
// deciding, and migration 0007 over the shape before it.
import { afterEach, expect, test } from "vitest";
import { addCandidate, getCandidate } from "../../src/server/generation-store.js";
import { hiddenInSession, listHides, setHidden } from "../../src/server/hide-store.js";
import { openStore, readMigrations } from "../../src/server/store.js";
import { fillStore, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A store with every table filled, and a second candidate in the same session. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const ids = fillStore(made.store);
  const sessionId = /** @type {number} */ (getCandidate(made.store, ids.candidates)?.sessionId);
  const second = addCandidate(made.store, {
    vibeRevisionId: ids.vibe_revisions,
    generationId: null,
    sessionId,
    genomeId: ids.genomes,
    seed: 8,
    source: "mutation",
    parentIds: [ids.candidates],
    locks: [],
    operator: "nudge",
    operatorParams: { stepSize: "small" },
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return { ...made, ids, sessionId, first: ids.candidates, second: second.id };
}

test("a hide and an unhide round-trip, and both rows stay as history", async () => {
  const { store, reopen, sessionId, first, second } = await setup();
  // fillStore hid its candidate; showing it again leaves the session with none hidden.
  setHidden(store, [first], false);
  expect(hiddenInSession(store, sessionId)).toEqual(new Set());

  const hid = setHidden(store, [first, second], true);
  expect(hid.map((row) => [row.candidateId, row.hidden])).toEqual([
    [first, true],
    [second, true],
  ]);
  expect(hiddenInSession(reopen(), sessionId)).toEqual(new Set([first, second]));

  const shown = setHidden(reopen(), [second], false);
  expect(shown).toMatchObject([{ candidateId: second, hidden: false, removedAt: null }]);
  const store2 = reopen();
  expect(hiddenInSession(store2, sessionId)).toEqual(new Set([first]));
  // Unhiding appended a row; the hide before it is still there, not removed.
  expect(listHides(store2, second).map((row) => [row.hidden, row.removedAt])).toEqual([
    [true, null],
    [false, null],
  ]);
});

test("asking for the state a candidate is already in adds no row", async () => {
  const { store, first } = await setup();
  const before = listHides(store, first).length;
  expect(setHidden(store, [first], false)).toHaveLength(1);
  expect(setHidden(store, [first], false)).toEqual([]);
  expect(listHides(store, first)).toHaveLength(before + 1);
});

test("a hide naming a candidate that doesn't exist stores nothing", async () => {
  const { store, sessionId, second } = await setup();
  expect(() => setHidden(store, [second, 999], true)).toThrow(/FOREIGN KEY/);
  expect(hiddenInSession(store, sessionId).has(second)).toBe(false);
});

test("the hide table is append-only", async () => {
  const { store, second } = await setup();
  const [row] = setHidden(store, [second], true);
  const run = (/** @type {string} */ sql) => store.db.prepare(sql).run(row?.id ?? 0);
  expect(() => run("DELETE FROM candidate_hides WHERE id = ?")).toThrow(/append-only/);
  expect(() => run("UPDATE candidate_hides SET hidden = 0 WHERE id = ?")).toThrow(/append-only/);
});

test("migration 0007 over a database built with 0001 to 0006 keeps its rows and adds hides", async () => {
  const { paths, now } = await setup();
  const file = `${paths.database}-0006`;
  const migrations = readMigrations();
  const old = openStore(file, { now, migrations: migrations.slice(0, 6) });
  const run = (/** @type {string} */ sql) => old.db.prepare(sql).run();
  run("INSERT INTO vibes (id, createdAt) VALUES (1, 0)");
  run(
    `INSERT INTO vibe_revisions (id, vibeId, name, brief, constraints, softTargets, createdAt)
     VALUES (1, 1, 'v', 'b', '{}', '{}', 0)`,
  );
  run("INSERT INTO session_events (id, vibeId, kind, createdAt) VALUES (1, 1, 'start', 0)");
  run(
    `INSERT INTO candidates (id, vibeRevisionId, sessionId, seed, source, parentIds, locks, createdAt)
     VALUES (1, 1, 1, 3, 'llm', '[]', '[]', 0)`,
  );
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  expect(store.db.prepare("SELECT count(*) AS n FROM candidates").get()?.n).toBe(1);
  expect(hiddenInSession(store, 1)).toEqual(new Set());
  setHidden(store, [1], true);
  expect(hiddenInSession(store, 1)).toEqual(new Set([1]));
  const flag = "INSERT INTO candidate_hides (candidateId, hidden, createdAt) VALUES (1, 2, 0)";
  expect(() => store.db.prepare(flag).run()).toThrow(/CHECK constraint/);
});

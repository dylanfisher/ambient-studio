// A track's developments (decision 0079): append-only, developing again keeps the earlier row,
// migration 0013 over 0012's shape adds the table, and migration 0014 over 0013's gives every
// stored section `developmentId: null`.
/** @import { Store } from "../../src/server/store.js" */
import { afterEach, expect, test } from "vitest";
import { emptyArrangement, SECTION_KEYS } from "../../src/domain/arrangement-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import {
  addDevelopment,
  getDevelopment,
  listDevelopments,
} from "../../src/server/development-store.js";
import { addCandidate, addGeneration, putGenome } from "../../src/server/generation-store.js";
import { addSketch } from "../../src/server/rating-store.js";
import { markRemoved, openStore, readMigrations, TABLE } from "../../src/server/store.js";
import { createTrack, listTrackRevisions } from "../../src/server/track-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/**
 * A vibe with one sketch of the drone, a track and one generation, the rows a development names.
 * @param {Store} store
 */
function parts(store) {
  const vibe = createVibe(store, {
    name: "dawn",
    brief: "a hum",
    constraints: {},
    softTargets: {},
  });
  const genome = putGenome(store, vibe.id, droneGenome);
  const generation = addGeneration(store, {
    vibeRevisionId: vibe.revision.id,
    sessionId: null,
    requestGroup: "vibe-1-develop-3",
    prompt: [],
    exampleIds: [],
    attachmentIds: [],
    retrievalMethod: "none",
    model: "m",
    sampling: {},
    response: "{}",
    finishReason: "stop",
    repairRound: 0,
    repairsId: null,
    latencyMs: 1,
    firstTokenMs: null,
    promptTokens: null,
    completionTokens: null,
    reasoning: null,
    requestParams: null,
    retries: null,
    error: null,
  });
  const candidate = addCandidate(store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: genome.id,
    seed: 7,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  const sketch = addSketch(store, { candidateId: candidate.id, notes: "", tags: [] });
  const { track } = createTrack(store, {
    vibeId: vibe.id,
    name: "t",
    arrangement: emptyArrangement(),
  });
  return {
    trackId: track.id,
    sketchId: sketch.id,
    text: "thin out toward the end",
    offset: 30,
    seconds: 240,
    genomeId: genome.id,
    seed: 7,
    generationId: generation.id,
  };
}

test("developing again keeps the earlier row; rows are append-only and removed by mark", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const draft = parts(store);
  const first = addDevelopment(store, draft);
  const second = addDevelopment(store, { ...draft, text: "rise instead" });
  expect(first).toMatchObject({ ...draft, removedAt: null, removedReason: null });
  expect(getDevelopment(store, first.id)).toEqual(first);
  expect(listDevelopments(store, draft.trackId)).toEqual([first, second]);
  expect(() => store.db.prepare("DELETE FROM developments").run()).toThrow(/append-only/);
  expect(() =>
    store.db.prepare("UPDATE developments SET text = 'x' WHERE id = ?").run(first.id),
  ).toThrow(/append-only/);
  markRemoved(store, TABLE.developments, first.id, "removed");
  expect(listDevelopments(store, draft.trackId)).toEqual([second]);
  expect(getDevelopment(store, first.id)?.removedReason).toBe("removed");
  expect(() => addDevelopment(store, { ...draft, genomeId: 999 })).toThrow(/FOREIGN KEY/);
  expect(() => addDevelopment(store, { ...draft, seconds: 0 })).toThrow(/CHECK constraint/);
});

test("migration 0013 over a database built with 0001 to 0012 keeps its rows and adds developments", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { paths, store: current } = made;
  current.close();
  const file = `${paths.database}-0012`;
  const migrations = readMigrations();
  expect(migrations[12]?.name).toBe("0013-developments");
  const now = () => 0;
  const old = openStore(file, { now, migrations: migrations.slice(0, 12) });
  const draft = parts(old);
  expect(() => old.db.prepare("SELECT * FROM developments").all()).toThrow(/no such table/);
  old.close();

  const store = openStore(file, { now, migrations: migrations.slice(0, 13) });
  cleanups.push(async () => store.close());
  expect(listTrackRevisions(store, draft.trackId)).toHaveLength(1);
  const development = addDevelopment(store, draft);
  expect(listDevelopments(store, draft.trackId)).toEqual([development]);
  // The append-only triggers cover the new table once migrated from 0012's shape.
  expect(() => store.db.prepare("DELETE FROM developments").run()).toThrow(/append-only/);
  expect(() => store.db.prepare("UPDATE developments SET createdAt = 1").run()).toThrow(
    /append-only/,
  );
});

test("migration 0014 gives every section of every stored revision no development", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { paths, store: current } = made;
  current.close();
  const file = `${paths.database}-0013`;
  const migrations = readMigrations();
  expect(migrations[13]?.name).toBe("0014-section-development");
  const now = () => 0;
  const old = openStore(file, { now, migrations: migrations.slice(0, 13) });
  const vibe = createVibe(old, { name: "dawn", brief: "a hum", constraints: {}, softTargets: {} });
  // Revisions in 0013's shape, written by hand: sections with text and no development.
  const before = {
    length: 600,
    arc: "emerge, plateau, dissolve",
    sections: [
      { sketchId: 1, offset: 12.5, seconds: 60, text: "only the drone" },
      { sketchId: 2, offset: 0, seconds: 90, text: "" },
    ],
    transitions: [{ kind: "morph", seconds: 12, curve: "late", text: "" }],
    lanes: [
      {
        macro: "brightness",
        points: [
          [0, 0],
          [100, -0.25, "smooth"],
        ],
      },
    ],
    proposal: null,
  };
  old.db
    .prepare("INSERT INTO tracks (id, vibeId, name, createdAt) VALUES (1, ?, 't', 0)")
    .run(vibe.id);
  const insert = old.db.prepare(
    "INSERT INTO track_revisions (trackId, arrangement, note, createdAt) VALUES (1, ?, ?, 0)",
  );
  insert.run(JSON.stringify(emptyArrangement()), "empty");
  insert.run(JSON.stringify(before), "two");
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  const [empty, two] = listTrackRevisions(store, 1);
  expect(empty?.arrangement).toEqual(emptyArrangement());
  expect(two?.note).toBe("two");
  expect(two?.arrangement).toEqual({
    ...before,
    sections: before.sections.map((section) => ({ ...section, developmentId: null })),
  });
  // Each key in the order a stored one lists them, so a migrated revision reads as a new one.
  for (const section of two?.arrangement.sections ?? []) {
    expect(Object.keys(section)).toEqual(SECTION_KEYS);
  }
  expect(Object.keys(two?.arrangement.transitions[0] ?? {})).toEqual(
    Object.keys(before.transitions[0] ?? {}),
  );
  expect(() => store.db.prepare("UPDATE track_revisions SET note = 'x'").run()).toThrow(
    /append-only/,
  );
});

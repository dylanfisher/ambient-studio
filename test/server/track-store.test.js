// Tracks, their revisions and their exports (decision 0061): append-only, a removed track keeps
// its rows, migration 0011 over 0010's shape, and migration 0012 over 0011's.
/** @import { Store } from "../../src/server/store.js" */
import { afterEach, expect, test } from "vitest";
import {
  emptyArrangement,
  SECTION_KEYS,
  TRANSITION_KEYS,
} from "../../src/domain/arrangement-schema.js";
import { openStore, readMigrations } from "../../src/server/store.js";
import {
  addTrackExport,
  createTrack,
  getTrack,
  listTrackExports,
  listTrackRevisions,
  listTracks,
  removeTrack,
  reviseTrack,
  TRACK_REMOVED,
} from "../../src/server/track-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** @param {Store} store */
const vibeOf = (store) =>
  createVibe(store, { name: "dawn", brief: "a low hum", constraints: {}, softTargets: {} });

const ONE = {
  ...emptyArrangement(),
  sections: [{ sketchId: 1, offset: 0, seconds: 60, text: "" }],
};

test("saving twice keeps both revisions, the newest last", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = vibeOf(store);
  const { track, revision: first } = createTrack(store, {
    vibeId: vibe.id,
    name: "first light",
    arrangement: emptyArrangement(),
  });
  expect(track).toMatchObject({ vibeId: vibe.id, name: "first light", removedAt: null });
  expect(first).toMatchObject({ trackId: track.id, arrangement: emptyArrangement(), note: "" });
  const second = reviseTrack(store, track.id, { arrangement: ONE, note: "one section" });
  const third = reviseTrack(store, track.id, { arrangement: ONE, note: "" });
  expect(listTrackRevisions(store, track.id).map((row) => row.id)).toEqual([
    first.id,
    second.id,
    third.id,
  ]);
  expect(listTrackRevisions(store, track.id)[1]).toEqual(second);
  expect(listTracks(store, vibe.id)).toEqual([{ ...track, revision: third }]);
  expect(() => store.db.prepare("DELETE FROM track_revisions").run()).toThrow(/append-only/);
  expect(() =>
    store.db.prepare("UPDATE track_revisions SET note = 'x' WHERE id = ?").run(first.id),
  ).toThrow(/append-only/);
});

test("a removed track keeps its rows and leaves the list", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = vibeOf(store);
  const { track, revision } = createTrack(store, {
    vibeId: vibe.id,
    name: "gone",
    arrangement: ONE,
  });
  const exported = addTrackExport(store, {
    trackRevisionId: revision.id,
    kind: "mix",
    folder: "gone-1",
    manifestSha256: "a".repeat(64),
  });
  removeTrack(store, track.id);
  expect(getTrack(store, track.id)).toMatchObject({ removedReason: TRACK_REMOVED });
  expect(listTracks(store, vibe.id)).toEqual([]);
  expect(listTrackRevisions(store, track.id)).toEqual([revision]);
  expect(listTrackExports(store, revision.id)).toEqual([exported]);
  expect(() => removeTrack(store, track.id)).toThrow(/append-only/);
});

test("an export's kind and manifest hash are checked", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const { revision } = createTrack(store, {
    vibeId: vibeOf(store).id,
    name: "t",
    arrangement: ONE,
  });
  /** @type {any} */
  const draft = { trackRevisionId: revision.id, kind: "mix", folder: "t-1", manifestSha256: "a" };
  expect(() => addTrackExport(store, draft)).toThrow(/CHECK constraint/);
  expect(() =>
    addTrackExport(store, { ...draft, kind: "mp3", manifestSha256: "a".repeat(64) }),
  ).toThrow(/CHECK constraint/);
  expect(() =>
    addTrackExport(store, { ...draft, trackRevisionId: 999, manifestSha256: "a".repeat(64) }),
  ).toThrow(/FOREIGN KEY/);
});

test("migration 0011 over a database built with 0001 to 0010 keeps its rows and adds tracks", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { paths, store: current } = made;
  current.close();
  const file = `${paths.database}-0010`;
  const migrations = readMigrations();
  expect(migrations[10]?.name).toBe("0011-tracks");
  const now = () => 0;
  const old = openStore(file, { now, migrations: migrations.slice(0, 10) });
  const vibe = vibeOf(old);
  expect(() => old.db.prepare("SELECT * FROM tracks").all()).toThrow(/no such table/);
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  expect(store.db.prepare("SELECT name FROM vibe_revisions").all()).toEqual([{ name: "dawn" }]);
  const { track, revision } = createTrack(store, {
    vibeId: vibe.id,
    name: "after",
    arrangement: ONE,
  });
  expect(getTrack(store, track.id)?.vibeId).toBe(vibe.id);
  expect(listTrackRevisions(store, track.id)).toEqual([revision]);
  expect(() =>
    store.db.prepare("INSERT INTO tracks (vibeId, name, createdAt) VALUES (999, 'x', 0)").run(),
  ).toThrow(/FOREIGN KEY/);
  expect(() =>
    store.db
      .prepare(
        "INSERT INTO track_revisions (trackId, arrangement, note, createdAt) VALUES (?, 'not json', '', 0)",
      )
      .run(track.id),
  ).toThrow(/CHECK constraint/);
  addTrackExport(store, {
    trackRevisionId: revision.id,
    kind: "mix",
    folder: "after-1",
    manifestSha256: "b".repeat(64),
  });
  // The append-only triggers cover 0011's tables once migrated from 0010's shape.
  for (const table of ["tracks", "track_revisions", "track_exports"]) {
    expect(() => store.db.prepare(`DELETE FROM ${table}`).run(), table).toThrow(/append-only/);
    expect(() => store.db.prepare(`UPDATE ${table} SET createdAt = 1`).run(), table).toThrow(
      /append-only/,
    );
  }
});

test("migration 0012 gives every section and transition of every stored revision empty text", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { paths, store: current } = made;
  current.close();
  const file = `${paths.database}-0011`;
  const migrations = readMigrations();
  expect(migrations[11]?.name).toBe("0012-section-text");
  const now = () => 0;
  const old = openStore(file, { now, migrations: migrations.slice(0, 11) });
  const vibe = vibeOf(old);
  // Revisions in 0011's shape, written by hand: sections and transitions with no text.
  const before = {
    length: 600,
    arc: "emerge, plateau, dissolve",
    sections: [
      { sketchId: 1, offset: 12.5, seconds: 60 },
      { sketchId: 2, offset: 0, seconds: 90 },
      { sketchId: 1, offset: 30, seconds: 45 },
    ],
    transitions: [
      { kind: "morph", seconds: 12, curve: "late" },
      { kind: "crossfade", seconds: 8 },
    ],
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
  insert.run(JSON.stringify(before), "three");
  old.close();

  const store = openStore(file, { now, migrations });
  cleanups.push(async () => store.close());
  const [empty, three] = listTrackRevisions(store, 1);
  expect(empty?.arrangement).toEqual(emptyArrangement());
  expect(three?.note).toBe("three");
  expect(three?.arrangement).toEqual({
    ...before,
    sections: before.sections.map((section) => ({ ...section, text: "" })),
    transitions: before.transitions.map((transition) => ({ ...transition, text: "" })),
  });
  // Each key in the order a stored one lists them, so a migrated revision reads as a new one.
  for (const section of three?.arrangement.sections ?? []) {
    expect(Object.keys(section)).toEqual(SECTION_KEYS);
  }
  expect(three?.arrangement.transitions.map((transition) => Object.keys(transition))).toEqual([
    TRANSITION_KEYS.morph,
    TRANSITION_KEYS.crossfade,
  ]);
  expect(() => store.db.prepare("UPDATE track_revisions SET note = 'x'").run()).toThrow(
    /append-only/,
  );
});

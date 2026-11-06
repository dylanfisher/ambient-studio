// Vibes, their revisions and notes (decision 0021).
import { afterEach, describe, expect, test } from "vitest";
import { markRemoved } from "../../src/server/store.js";
import {
  addNote,
  createVibe,
  getVibe,
  listNotes,
  listRevisions,
  listVibes,
  reviseVibe,
} from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

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

const draft = {
  name: "cold drone",
  brief: "slow, cold, D dorian",
  constraints: { tuning: "12tet", loudness: -16 },
  softTargets: { brightness: [0.2, 0.4] },
};

describe("vibes", () => {
  test("a created vibe reads back with its first revision after a reopen", async () => {
    const { store, reopen } = await made();
    const vibe = createVibe(store, draft);
    expect(vibe.revision).toMatchObject({ ...draft, vibeId: vibe.id });
    expect(vibe).toMatchObject({ removedAt: null, removedReason: null });
    expect(getVibe(reopen(), vibe.id)).toEqual(vibe);
  });

  test("an edit appends a revision, and the vibe reads as its newest", async () => {
    const { store, reopen } = await made();
    const vibe = createVibe(store, draft);
    const revised = reviseVibe(store, vibe.id, { ...draft, brief: "slower" });
    const reopened = reopen();
    expect(getVibe(reopened, vibe.id)?.revision).toEqual(revised);
    expect(listRevisions(reopened, vibe.id)).toEqual([vibe.revision, revised]);
  });

  test("an unknown vibe reads as undefined, and revising one throws", async () => {
    const { store } = await made();
    expect(getVibe(store, 1)).toBeUndefined();
    expect(() => reviseVibe(store, 1, draft)).toThrow(/FOREIGN KEY/);
  });

  test("the list leaves out removed vibes and is in creation order", async () => {
    const { store } = await made();
    const one = createVibe(store, draft);
    const two = createVibe(store, { ...draft, name: "bells" });
    const three = createVibe(store, { ...draft, name: "tide" });
    markRemoved(store, "vibes", two.id, "test");
    expect(listVibes(store).map((vibe) => vibe.id)).toEqual([one.id, three.id]);
  });
});

describe("notes", () => {
  test("a note reads back after a reopen, and a removed one is left out", async () => {
    const { store, reopen } = await made();
    const vibe = createVibe(store, draft);
    const kept = addNote(store, { vibeId: vibe.id, text: "less shimmer" });
    const dropped = addNote(store, { vibeId: vibe.id, text: "typo" });
    markRemoved(store, "notes", dropped.id, "typo");
    expect(listNotes(reopen(), vibe.id)).toEqual([kept]);
  });
});

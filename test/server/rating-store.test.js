// Ratings, feedback and notes read back equal after the store is closed and reopened
// (decision 0021; the store half of phase 2's acceptance 4).
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putGenome } from "../../src/server/generation-store.js";
import {
  addFeedback,
  addRatedAudio,
  addRating,
  addSketch,
  getFeedback,
  getRating,
  getSketch,
  listRatedAudio,
} from "../../src/server/rating-store.js";
import { startSession } from "../../src/server/session-store.js";
import { addNote, createVibe, listNotes } from "../../src/server/vibe-store.js";
import { fillStore, heardExcerpt, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A vibe, a session, the drone genome and its rated excerpt. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const session = startSession(store, vibe.id);
  const genome = putGenome(store, vibe.id, droneGenome);
  const heard = heardExcerpt(genome.id);
  const audio = addRatedAudio(store, {
    ...heard,
    target: -16,
    file: "a.flac",
    pcmSha256: "ab".repeat(32),
    gainDb: 2.25,
  });
  const common = { sessionId: session.id, vibeRevisionId: vibe.revision.id };
  const block = { ...common, ...heard, ratedAudioId: audio.id, playedFraction: 0.6 };
  return { ...made, vibe, heard, audio, common, block: { ...block, timeTakenMs: 3000 } };
}

const unranked = { rank: null, score: null, modelVersion: null, wildcard: null };

test("a rating, thumbs, a note and directional feedback read back equal after a reopen", async () => {
  const { store, reopen, vibe, heard, audio, common, block } = await setup();
  const side = { ...heard, ratedAudioId: audio.id };
  const rating = addRating(store, {
    ...common,
    a: { ...side, playedFraction: 0.75, rank: 1, score: 0.5, modelVersion: "m1", wildcard: true },
    b: { ...side, playedFraction: 1, ...unranked },
    leftSide: "a",
    orderSeed: 42,
    outcome: "b",
    timeTakenMs: 8123,
  });
  const thumbs = addFeedback(store, {
    ...block,
    kind: "thumbs",
    direction: "down",
    note: "too bright",
    macro: null,
    macroValue: null,
  });
  const direction = addFeedback(store, {
    ...block,
    kind: "macro",
    direction: "more",
    note: null,
    macro: "brightness",
    macroValue: { min: 0.2, mean: 0.3, max: 0.4 },
  });
  const note = addNote(store, { vibeId: vibe.id, text: "more air" });
  expect(rating.a.wildcard).toBe(true);
  expect(rating.b).toEqual({ ...side, playedFraction: 1, ...unranked });
  expect(direction.macroValue).toEqual({ min: 0.2, mean: 0.3, max: 0.4 });

  const reopened = reopen();
  expect(getRating(reopened, rating.id)).toEqual(rating);
  expect(getFeedback(reopened, thumbs.id)).toEqual(thumbs);
  expect(getFeedback(reopened, direction.id)).toEqual(direction);
  expect(listNotes(reopened, vibe.id)).toEqual([note]);
  expect(listRatedAudio(reopened)).toEqual([audio]);
});

test("feedback whose kind and direction don't fit together is refused", async () => {
  const { store, block } = await setup();
  const thumbsMore = {
    ...block,
    kind: /** @type {const} */ ("thumbs"),
    direction: /** @type {const} */ ("more"),
    note: null,
    macro: null,
    macroValue: null,
  };
  expect(() => addFeedback(store, thumbsMore)).toThrow(/CHECK constraint/);
});

test("a second rated_audio row for one heard identity is refused", async () => {
  const { store, heard } = await setup();
  const again = { ...heard, target: -16, file: "b.flac", pcmSha256: "cd".repeat(32), gainDb: 0 };
  expect(() => addRatedAudio(store, again)).toThrow(/UNIQUE/);
});

test("a sketch reads back after a reopen", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { candidates } = fillStore(made.store);
  const sketch = addSketch(made.store, {
    candidateId: candidates,
    notes: "the slow one",
    tags: ["cold", "keep"],
  });
  expect(getSketch(made.reopen(), sketch.id)).toEqual(sketch);
});

test("a rating or feedback whose heard identity differs from its rated audio is refused", async () => {
  const { store, common, heard, audio, block } = await setup();
  const side = { ...heard, ratedAudioId: audio.id, playedFraction: 1, ...unranked };
  const rating = {
    ...common,
    leftSide: /** @type {const} */ ("a"),
    orderSeed: 1,
    outcome: /** @type {const} */ ("tie"),
    timeTakenMs: 1,
  };
  expect(() => addRating(store, { ...rating, a: side, b: { ...side, seed: 8 } })).toThrow(
    /side b .*seed 8.*rated audio .*seed 7/,
  );
  expect(() =>
    addRating(store, { ...rating, a: { ...side, ratedAudioId: audio.id + 9 }, b: side }),
  ).toThrow(/side a .*no rated audio/);
  const thumbs = {
    ...block,
    kind: /** @type {const} */ ("thumbs"),
    direction: /** @type {const} */ ("up"),
    note: null,
    macro: null,
    macroValue: null,
  };
  expect(() => addFeedback(store, { ...thumbs, engineVersion: 1 })).toThrow(
    /feedback .*engineVersion 1.*engineVersion 2/,
  );
  expect(store.db.prepare("SELECT count(*) AS n FROM ratings").get()?.n).toBe(0);
});

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
  FEEDBACK_KIND,
  getFeedback,
  getRating,
  getSketch,
  listRatedAudio,
  listRatedGenomes,
  MACRO_DIRECTIONS,
  OUTCOMES,
  THUMBS,
} from "../../src/server/rating-store.js";
import { startSession } from "../../src/server/session-store.js";
import { markRemoved } from "../../src/server/store.js";
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

// The JS lists the routes check against and the CHECKs in migration 0001 must name the same
// values: every listed value is stored, and one outside each list is refused.
test("every value of OUTCOMES, THUMBS, MACRO_DIRECTIONS and FEEDBACK_KIND is stored, one outside is refused", async () => {
  const { store, heard, audio, common, block } = await setup();
  const side = { ...heard, ratedAudioId: audio.id, playedFraction: 1, ...unranked };
  /** @param {string} outcome */
  const rate = (outcome) =>
    addRating(store, {
      ...common,
      a: side,
      b: side,
      leftSide: "a",
      orderSeed: 1,
      outcome: /** @type {any} */ (outcome),
      timeTakenMs: 1,
    });
  for (const outcome of OUTCOMES) expect(rate(outcome).outcome).toBe(outcome);
  expect(() => rate("draw")).toThrow(/CHECK constraint/);

  /** @param {string} kind @param {string} direction */
  const feedback = (kind, direction) => {
    const isMacro = kind === FEEDBACK_KIND.macro;
    return addFeedback(store, {
      ...block,
      kind: /** @type {any} */ (kind),
      direction: /** @type {any} */ (direction),
      note: null,
      macro: isMacro ? "brightness" : null,
      macroValue: isMacro ? { min: 0.5, max: 0.5, mean: 0.5 } : null,
    });
  };
  expect(Object.values(FEEDBACK_KIND).sort()).toEqual(["macro", "thumbs"]);
  for (const direction of THUMBS) {
    expect(feedback(FEEDBACK_KIND.thumbs, direction).direction).toBe(direction);
  }
  for (const direction of MACRO_DIRECTIONS) {
    expect(feedback(FEEDBACK_KIND.macro, direction).direction).toBe(direction);
  }
  expect(() => feedback(FEEDBACK_KIND.thumbs, "sideways")).toThrow(/CHECK constraint/);
  expect(() => feedback(FEEDBACK_KIND.macro, "sideways")).toThrow(/CHECK constraint/);
  expect(() => feedback("slider", THUMBS[0])).toThrow(/CHECK constraint/);
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

test("listRatedGenomes scores a vibe's genomes by thumbs and A/B wins, newest rating first", async () => {
  const { store, vibe, common, block } = await setup();
  /** Rated audio for a variant of the drone genome in `vibeId`, and the side naming it. */
  const variant = (/** @type {number} */ level, vibeId = vibe.id) => {
    const voice = { ...droneGenome.voices[0], level };
    const genome = putGenome(store, vibeId, { ...droneGenome, voices: [voice] });
    const heard = heardExcerpt(genome.id);
    const file = `${genome.id}.flac`;
    const audio = addRatedAudio(store, {
      ...heard,
      target: -16,
      file,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    const named = { ...heard, ratedAudioId: audio.id };
    return { genomeId: genome.id, named, side: { ...named, playedFraction: 1, ...unranked } };
  };
  /** @typedef {ReturnType<typeof variant>} Variant */
  /** @param {Variant} rated @param {"up" | "down"} direction */
  const thumbs = (rated, direction) =>
    addFeedback(store, {
      ...block,
      ...rated.named,
      kind: "thumbs",
      direction,
      note: null,
      macro: null,
      macroValue: null,
    });
  /** @param {Variant} a @param {Variant} b @param {"a" | "b" | "tie" | "skip"} outcome */
  const ab = (a, b, outcome) =>
    addRating(store, {
      ...common,
      a: a.side,
      b: b.side,
      leftSide: "a",
      orderSeed: 1,
      outcome,
      timeTakenMs: 1,
    });

  const liked = variant(-11);
  const disliked = variant(-12);
  const even = variant(-13);
  const removed = variant(-14);
  const macroOnly = variant(-15);
  const other = createVibe(store, { name: "w", brief: "b", constraints: {}, softTargets: {} });
  const elsewhere = variant(-16, other.id);

  thumbs(liked, "up");
  ab(liked, disliked, "a");
  thumbs(even, "up");
  ab(disliked, even, "b");
  ab(liked, even, "tie");
  ab(even, liked, "skip");
  thumbs(disliked, "down");
  markRemoved(store, "feedback", thumbs(removed, "up").id, "test");
  addFeedback(store, {
    ...block,
    ...macroOnly.named,
    kind: "macro",
    direction: "more",
    note: null,
    macro: "brightness",
    macroValue: { min: 0.7, mean: 0.7, max: 0.7 },
  });
  thumbs(elsewhere, "up");

  const rated = listRatedGenomes(store, vibe.id);
  // Ties and skips count as nothing; the newest vote (tie and skip aside) orders the list.
  expect(rated.map(({ genomeId, score }) => ({ genomeId, score }))).toEqual([
    { genomeId: disliked.genomeId, score: -3 },
    { genomeId: even.genomeId, score: 2 },
    { genomeId: liked.genomeId, score: 2 },
  ]);
  const [newest, next] = rated;
  expect(newest?.lastRatedAt).toBeGreaterThan(next?.lastRatedAt ?? Number.POSITIVE_INFINITY);
});

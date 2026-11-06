// Examples for the prompt, by rating and recency until CLAP arrives in phase 4 (decision 0024).
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putGenome } from "../../src/server/generation-store.js";
import { addFeedback, addRatedAudio } from "../../src/server/rating-store.js";
import {
  EXAMPLES_PER_SIDE,
  RETRIEVAL_METHOD,
  retrieveExamples,
} from "../../src/server/retrieve-examples.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { heardExcerpt, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("takes the newest liked and disliked genomes in turn, up to the limit on each side", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const session = startSession(store, vibe.id);
  /** A drone variant rated once with thumbs; returns its genome row. */
  const rate = (/** @type {number} */ level, /** @type {"up" | "down"} */ direction) => {
    const voice = { ...droneGenome.voices[0], level };
    const genome = putGenome(store, vibe.id, { ...droneGenome, voices: [voice] });
    const heard = heardExcerpt(genome.id);
    const audio = addRatedAudio(store, {
      ...heard,
      target: -16,
      file: `${genome.id}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    addFeedback(store, {
      ...heard,
      sessionId: session.id,
      vibeRevisionId: vibe.revision.id,
      ratedAudioId: audio.id,
      playedFraction: 1,
      timeTakenMs: 1,
      kind: "thumbs",
      direction,
      note: null,
      macro: null,
      macroValue: null,
    });
    return genome;
  };
  // Oldest first: five liked, then two disliked.
  const liked = [-11, -12, -13, -14, -15].map((level) => rate(level, "up"));
  const disliked = [-21, -22].map((level) => rate(level, "down"));

  const { method, examples } = retrieveExamples(store, vibe.id);
  expect(method).toBe(RETRIEVAL_METHOD);
  expect(EXAMPLES_PER_SIDE).toBe(3);
  const newestLiked = liked.slice(-EXAMPLES_PER_SIDE).reverse();
  const newestDisliked = disliked.slice().reverse();
  expect(examples).toEqual([
    { id: newestLiked[0]?.id, liked: true, genome: newestLiked[0]?.genome },
    { id: newestDisliked[0]?.id, liked: false, genome: newestDisliked[0]?.genome },
    { id: newestLiked[1]?.id, liked: true, genome: newestLiked[1]?.genome },
    { id: newestDisliked[1]?.id, liked: false, genome: newestDisliked[1]?.genome },
    { id: newestLiked[2]?.id, liked: true, genome: newestLiked[2]?.genome },
  ]);
});

test("a vibe with nothing rated gets no examples", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const vibe = createVibe(made.store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  expect(retrieveExamples(made.store, vibe.id)).toEqual({ method: RETRIEVAL_METHOD, examples: [] });
});

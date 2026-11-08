// Examples for the prompt (decision 0024): by rating and recency, or nearest the brief by CLAP
// text-to-audio similarity when the rated audio has embeddings.
/** @import { TextEmbedder } from "../../src/server/retrieve-examples.js" */
/** @import { Store } from "../../src/server/store.js" */
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putEmbedding } from "../../src/server/embedding-store.js";
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

const BRIEF = "slow and cold";
const PRODUCER = "fake-clap@1 clap-aa";

/** A vibe and a way to rate drone variants in it. */
async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: BRIEF, constraints: {}, softTargets: {} });
  const session = startSession(store, vibe.id);
  /**
   * A drone variant rated with one thumbs per offset; returns its genome row and each rated
   * audio's id.
   * @param {number} level
   * @param {"up" | "down"} direction
   * @param {number[]} [offsets]
   */
  const rate = (level, direction, offsets = [12.5]) => {
    const voice = { ...droneGenome.voices[0], level };
    const genome = putGenome(store, vibe.id, { ...droneGenome, voices: [voice] });
    const audioIds = offsets.map((offset) => {
      const heard = { ...heardExcerpt(genome.id), offset };
      const audio = addRatedAudio(store, {
        ...heard,
        target: -16,
        file: `${genome.id}-${offset}.flac`,
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
      return audio.id;
    });
    return { genome, audioIds };
  };
  return { store, vibe, rate };
}

/**
 * Stores `floats` as the rated audio's embedding under `PRODUCER`.
 * @param {Store} store
 * @param {number} ratedAudioId
 * @param {number[]} floats
 */
const embed = (store, ratedAudioId, floats) =>
  putEmbedding(store, {
    ratedAudioId,
    renderId: null,
    producer: PRODUCER,
    vector: new Uint8Array(new Float32Array(floats).buffer),
  });

/**
 * A text embedder that answers [1, 0] and records each text it was asked for.
 * @returns {TextEmbedder & { texts: string[] }}
 */
function textEmbedder() {
  /** @type {string[]} */
  const texts = [];
  return {
    producer: PRODUCER,
    texts,
    embedText: async (text) => {
      texts.push(text);
      return new Float32Array([1, 0]);
    },
  };
}

/** @param {{ genome: { id: number, genome: unknown } }} rated @param {boolean} liked */
const example = ({ genome }, liked) => ({ id: genome.id, liked, genome: genome.genome });

test("takes the newest liked and disliked genomes in turn, up to the limit on each side", async () => {
  const { store, vibe, rate } = await setup();
  // Oldest first: five liked, then two disliked.
  const liked = [-11, -12, -13, -14, -15].map((level) => rate(level, "up"));
  const disliked = [-21, -22].map((level) => rate(level, "down"));

  const { method, examples } = await retrieveExamples(store, vibe.id, BRIEF, null);
  expect(method).toBe(RETRIEVAL_METHOD.ratingRecency);
  expect(EXAMPLES_PER_SIDE).toBe(3);
  const [l1, l2, l3] = liked.slice(-EXAMPLES_PER_SIDE).reverse();
  const [d1, d2] = disliked.slice().reverse();
  if (!l1 || !l2 || !l3 || !d1 || !d2) throw new Error("expected five liked and two disliked");
  expect(examples).toEqual([
    example(l1, true),
    example(d1, false),
    example(l2, true),
    example(d2, false),
    example(l3, true),
  ]);
});

test("a vibe with nothing rated gets no examples", async () => {
  const { store, vibe } = await setup();
  expect(await retrieveExamples(store, vibe.id, BRIEF, null)).toEqual({
    method: RETRIEVAL_METHOD.ratingRecency,
    examples: [],
  });
});

test("with embeddings, the liked and disliked nearest the brief come first, the unembedded after by recency", async () => {
  const { store, vibe, rate } = await setup();
  // Oldest first. The brief embeds to [1, 0]. By recency the liked would be unembeddedNew, mid,
  // near and the disliked farDisliked, nearDisliked.
  const unembeddedOld = rate(-11, "up");
  // Its two excerpts' mean, [0.8, 0.4], is 0.89 from the brief: below `mid`'s 0.95, though its
  // nearer excerpt alone is 1.
  const near = rate(-12, "up", [10, 20]);
  const mid = rate(-13, "up");
  const unembeddedNew = rate(-14, "up");
  const nearDisliked = rate(-21, "down");
  const farDisliked = rate(-22, "down");
  embed(store, /** @type {number} */ (near.audioIds[0]), [1, 0]);
  embed(store, /** @type {number} */ (near.audioIds[1]), [0.6, 0.8]);
  embed(store, /** @type {number} */ (mid.audioIds[0]), [0.95, Math.sqrt(1 - 0.95 ** 2)]);
  embed(store, /** @type {number} */ (nearDisliked.audioIds[0]), [0.8, 0.6]);
  embed(store, /** @type {number} */ (farDisliked.audioIds[0]), [-1, 0]);
  const embedder = textEmbedder();

  const { method, examples } = await retrieveExamples(store, vibe.id, BRIEF, embedder);
  expect(method).toBe(RETRIEVAL_METHOD.clapSimilarity);
  expect(embedder.texts).toEqual([BRIEF]);
  expect(examples).toEqual([
    example(mid, true),
    example(nearDisliked, false),
    example(near, true),
    example(farDisliked, false),
    example(unembeddedNew, true),
  ]);
  expect(examples.map((e) => e.id)).not.toContain(unembeddedOld.genome.id);
});

test("with an embedder but no embedded rated audio, the brief isn't embedded and the order is by recency", async () => {
  const { store, vibe, rate } = await setup();
  const older = rate(-11, "up");
  const newer = rate(-12, "up");
  // An embedding under another producer doesn't count.
  putEmbedding(store, {
    ratedAudioId: /** @type {number} */ (older.audioIds[0]),
    renderId: null,
    producer: "another-clap",
    vector: new Uint8Array(new Float32Array([1, 0]).buffer),
  });
  const embedder = textEmbedder();
  const { method, examples } = await retrieveExamples(store, vibe.id, BRIEF, embedder);
  expect(method).toBe(RETRIEVAL_METHOD.ratingRecency);
  expect(embedder.texts).toEqual([]);
  expect(examples).toEqual([example(newer, true), example(older, true)]);
});

test("a failure embedding the brief fails retrieval", async () => {
  const { store, vibe, rate } = await setup();
  embed(store, /** @type {number} */ (rate(-11, "up").audioIds[0]), [1, 0]);
  const embedder = {
    producer: PRODUCER,
    embedText: async () => {
      throw new Error("embedding the vibe's brief failed: the sidecar exited");
    },
  };
  await expect(retrieveExamples(store, vibe.id, BRIEF, embedder)).rejects.toThrow(
    /the sidecar exited/,
  );
});

// A vibe's training set read from the store (decision 0043), from rows seeded by hand: no
// excerpt is rendered.
import { afterEach, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import {
  addFeedback,
  addRatedAudio,
  addRating,
  undoRating,
} from "../../src/server/rating-store.js";
import { readTrainingSet } from "../../src/server/read-training-set.js";
import { putRender } from "../../src/server/render-store.js";
import { startSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { heardExcerpt, tempStore } from "../support/temp-store.js";
import { features } from "../support/training-rows.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const unranked = { rank: null, score: null, modelVersion: null, wildcard: null };
const TARGET = -16;

test("reads the vibe's live ratings and thumbs with each side's features, reporting a side with none", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const other = createVibe(store, { name: "w", brief: "b", constraints: {}, softTargets: {} });
  const session = startSession(store, vibe.id);
  const elsewhere = startSession(store, other.id);
  const common = { sessionId: session.id, vibeRevisionId: vibe.revision.id };

  /**
   * A genome of `vibeId`, its rated audio, and a render under this server's producer when
   * `rendered`.
   * @param {number} vibeId
   * @param {number} brightness
   * @param {boolean} rendered
   * @param {number} [engineVersion] the engine the owner heard it under
   */
  const heardSide = (vibeId, brightness, rendered, engineVersion = ENGINE_VERSION) => {
    const genome = putGenome(store, vibeId, {
      ...droneGenome,
      macros: { ...droneGenome.macros, brightness },
    });
    const heard = { ...heardExcerpt(genome.id), engineVersion };
    const audio = addRatedAudio(store, {
      ...heard,
      target: TARGET,
      file: `${genome.id}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    if (rendered) {
      const { engineVersion: _, ...window } = heard;
      putRender(store, {
        ...window,
        target: TARGET,
        producer: PRODUCER,
        file: `${genome.id}.wav`,
        features: features([audio.id]).get(audio.id),
        checks: {},
      });
    }
    return { ...heard, ratedAudioId: audio.id, playedFraction: 1 };
  };
  const x = heardSide(vibe.id, 0.1, true);
  const y = heardSide(vibe.id, 0.9, true);
  const unrendered = heardSide(vibe.id, 0.5, false);
  const older = heardSide(vibe.id, 0.3, true, ENGINE_VERSION - 1);
  const theirs = heardSide(other.id, 0.5, true);

  /** @param {typeof x} a @param {typeof x} b @param {"a" | "b" | "tie" | "skip"} outcome */
  const rate = (a, b, outcome, at = common) =>
    addRating(store, {
      ...at,
      a: { ...a, ...unranked },
      b: { ...b, ...unranked },
      leftSide: "a",
      orderSeed: 1,
      outcome,
      timeTakenMs: 1,
    });
  const win = rate(x, y, "b");
  const undone = rate(x, y, "a");
  undoRating(store, undone.id);
  const lacking = rate(x, unrendered, "a");
  const stale = rate(older, y, "tie");
  rate(theirs, theirs, "a", { sessionId: elsewhere.id, vibeRevisionId: other.revision.id });
  const up = addFeedback(store, {
    ...common,
    ...x,
    timeTakenMs: 1,
    kind: "thumbs",
    direction: "up",
    note: null,
    macro: null,
    macroValue: null,
  });

  const set = readTrainingSet(store, vibe.id);
  expect(set.pairs.map((p) => [p.ratingId, p.winner.ratedAudioId, p.loser.ratedAudioId])).toEqual([
    [win.id, y.ratedAudioId, x.ratedAudioId],
  ]);
  expect(set.pairs[0]?.winner.macros.brightness).toBeCloseTo(0.9, 12);
  expect(set.pairs[0]?.winner.features.centroidMean).toBe(100 * y.ratedAudioId);
  expect(set.thumbs.map((t) => [t.feedbackId, t.up])).toEqual([[up.id, true]]);
  expect(set.missing).toEqual([
    { ratingId: lacking.id, ratedAudioId: unrendered.ratedAudioId },
    { ratingId: stale.id, ratedAudioId: older.ratedAudioId },
  ]);
});

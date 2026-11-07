// The model key: a hash of what a model was fitted from (decision 0043).
import { describe, expect, test } from "vitest";
import { buildTrainingSet } from "../../src/domain/training-set.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { modelKey } from "../../src/server/model-key.js";
import { features, rating, thumbs } from "../support/training-rows.js";

const genomes = new Map([
  [1, droneGenome],
  [2, droneGenome],
]);
const heard = features([11, 12]);
const rows = [
  rating({ id: 4, outcome: "a" }),
  rating({ id: 5, outcome: "tie" }),
  rating({ id: 6, outcome: "b" }),
];
const feedback = [thumbs({ id: 7 }), thumbs({ id: 8, direction: "down" })];
const terms = {
  featureProducer: "engine-2 features-abc",
  embeddingProducer: "clap-test",
  hyperparameters: { pcaDimension: 8, priorScale: 1 },
};

/** @param {ReturnType<typeof rating>[]} ratings @param {ReturnType<typeof thumbs>[]} given */
const keyOf = (ratings, given = feedback, more = {}) =>
  modelKey(buildTrainingSet({ ratings, feedback: given, genomes, features: heard }), {
    ...terms,
    ...more,
  });

describe("modelKey", () => {
  test("is 64 hex characters", () => {
    expect(keyOf(rows)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("one more rating changes the key", () => {
    expect(keyOf([...rows, rating({ id: 9, outcome: "a" })])).not.toBe(keyOf(rows));
  });

  test("one more thumbs changes the key", () => {
    expect(keyOf(rows, [...feedback, thumbs({ id: 9 })])).not.toBe(keyOf(rows));
  });

  test("reordering the rows doesn't change the key", () => {
    expect(keyOf([...rows].reverse(), [...feedback].reverse())).toBe(keyOf(rows));
  });

  test("a rating removed or skipped is not in the key", () => {
    const removed = rating({ id: 9, outcome: "a", removedAt: 99, removedReason: "undone" });
    expect(keyOf([...rows, removed, rating({ id: 10, outcome: "skip" })])).toBe(keyOf(rows));
  });

  test("each producer and the hyperparameters change the key, their key order doesn't", () => {
    const base = keyOf(rows);
    expect(keyOf(rows, feedback, { featureProducer: "engine-2 features-abd" })).not.toBe(base);
    expect(keyOf(rows, feedback, { embeddingProducer: "clap-other" })).not.toBe(base);
    expect(keyOf(rows, feedback, { embeddingProducer: null })).not.toBe(base);
    expect(
      keyOf(rows, feedback, { hyperparameters: { pcaDimension: 12, priorScale: 1 } }),
    ).not.toBe(base);
    expect(keyOf(rows, feedback, { hyperparameters: { priorScale: 1, pcaDimension: 8 } })).toBe(
      base,
    );
  });

  test("a missing producer throws instead of keying on nothing", () => {
    expect(() => keyOf(rows, feedback, { embeddingProducer: undefined })).toThrow(
      "the embedding producer must be a string, or null for a fit without embeddings; got undefined",
    );
    expect(() => keyOf(rows, feedback, { featureProducer: "" })).toThrow(
      'the feature producer must be a non-empty string; got ""',
    );
  });
});

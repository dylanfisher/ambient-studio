// Leave-one-session-out folds, with no candidate shared between a fold's test and training
// sides (decision 0043).
import { describe, expect, test } from "vitest";
import { sessionFolds } from "../../src/domain/session-folds.js";
import { buildTrainingSet } from "../../src/domain/training-set.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { features, rating, thumbs } from "../support/training-rows.js";

/** Genomes 1 to 8, all the drone; candidates are told apart by genome id. */
const genomes = new Map(Array.from({ length: 8 }, (_, i) => [i + 1, droneGenome]));
const heard = features([1, 2, 3, 4, 5, 6, 7, 8]);

/**
 * A rating in `sessionId` of genome `x` against genome `y`, each heard as rated audio of the
 * same number.
 * @param {number} id
 * @param {number} sessionId
 * @param {number} x
 * @param {number} y
 * @param {"a" | "b" | "tie"} [outcome]
 */
const pair = (id, sessionId, x, y, outcome = "a") =>
  rating({ id, sessionId, outcome, a: x, b: y, aGenomeId: x, bGenomeId: y });

/** @param {import("../../src/domain/training-set.js").Pair} p */
const genomesOf = (p) => [p.winner.genomeId, p.loser.genomeId];

describe("sessionFolds", () => {
  const set = buildTrainingSet({
    ratings: [
      pair(1, 10, 1, 2),
      pair(2, 10, 3, 4, "tie"),
      pair(3, 20, 5, 6),
      pair(4, 20, 2, 7), // genome 2 was also rated in session 10
      pair(5, 30, 8, 5), // genome 5 was also rated in session 20
    ],
    feedback: [thumbs({ id: 9, sessionId: 30, ratedAudioId: 3, genomeId: 3 })],
    genomes,
    features: heard,
  });
  const folds = sessionFolds(set);
  const apart = buildTrainingSet({
    ratings: [pair(1, 10, 1, 2), pair(2, 20, 3, 4, "tie")],
    feedback: [],
    genomes,
    features: heard,
  });

  test("one fold per session with pairs, in session order, each holding its own session out", () => {
    expect(folds.map((f) => f.sessionId)).toEqual([10, 20, 30]);
    for (const fold of folds) {
      for (const p of [...fold.test, ...fold.leaked]) expect(p.sessionId).toBe(fold.sessionId);
      for (const p of fold.train.pairs) expect(p.sessionId).not.toBe(fold.sessionId);
      for (const t of fold.train.thumbs) expect(t.sessionId).not.toBe(fold.sessionId);
    }
  });

  test("no test pair shares a candidate with the fold's training pairs or thumbs", () => {
    for (const fold of [...folds, ...sessionFolds(apart)]) {
      const trained = new Set([
        ...fold.train.pairs.flatMap(genomesOf),
        ...fold.train.thumbs.map((t) => t.item.genomeId),
      ]);
      for (const p of fold.test) for (const g of genomesOf(p)) expect(trained.has(g)).toBe(false);
    }
  });

  test("a pair whose candidate appears in another session's pairs or thumbs is held back", () => {
    const byId = (/** @type {import("../../src/domain/training-set.js").Pair[]} */ pairs) =>
      pairs.map((p) => p.ratingId);
    const [ten, twenty, thirty] = folds;
    // Session 10: rating 1 shares genome 2 with rating 4; rating 2 shares genome 3 with thumbs 9.
    expect(byId(ten?.test ?? [])).toEqual([]);
    expect(byId(ten?.leaked ?? [])).toEqual([1, 2, 2]);
    expect(byId(twenty?.test ?? [])).toEqual([]);
    expect(byId(twenty?.leaked ?? [])).toEqual([3, 4]);
    expect(byId(thirty?.leaked ?? [])).toEqual([5]);
  });

  test("a session whose candidates appear nowhere else keeps all its pairs for testing", () => {
    const [ten, twenty] = sessionFolds(apart);
    expect(ten?.test.map((p) => p.ratingId)).toEqual([1]);
    expect(ten?.train.pairs.map((p) => p.ratingId)).toEqual([2, 2]);
    expect(twenty?.test.map((p) => p.ratingId)).toEqual([2, 2]);
    expect(twenty?.leaked).toEqual([]);
  });
});

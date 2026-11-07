// The training set built from a vibe's ratings and thumbs (decision 0043).
import { describe, expect, test } from "vitest";
import { FEATURE_NAMES } from "../../src/domain/feature-names.js";
import { buildTrainingSet } from "../../src/domain/training-set.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { features, rating, thumbs } from "../support/training-rows.js";

const genomes = new Map([
  [1, droneGenome],
  [2, { ...droneGenome, macros: { ...droneGenome.macros, brightness: 0.2 } }],
]);

describe("buildTrainingSet", () => {
  test("a win is one pair at full weight, the winner named by rated audio", () => {
    const set = buildTrainingSet({
      ratings: [rating({ id: 4, outcome: "b", leftSide: "b" })],
      feedback: [],
      genomes,
      features: features([11, 12]),
    });
    expect(set.pairs).toHaveLength(1);
    expect(set.pairs[0]).toMatchObject({
      ratingId: 4,
      sessionId: 1,
      weight: 1,
      tie: false,
      winnerLeft: true,
      winner: { ratedAudioId: 12, genomeId: 2 },
      loser: { ratedAudioId: 11, genomeId: 1 },
    });
    expect(set.missing).toEqual([]);
  });

  test("each side carries every named feature and each macro's mean over the heard window", () => {
    const set = buildTrainingSet({
      ratings: [rating({ id: 4, outcome: "a" })],
      feedback: [],
      genomes,
      features: features([11, 12]),
    });
    const [pair] = set.pairs;
    expect(Object.keys(pair?.winner.features ?? {})).toEqual(FEATURE_NAMES.map((f) => f.name));
    expect(pair?.winner.features.centroidMean).toBe(1100);
    expect(pair?.loser.features.centroidMean).toBe(1200);
    expect(Object.keys(pair?.winner.macros ?? {}).sort()).toEqual(Object.keys(MACROS).sort());
    expect(pair?.winner.macros.brightness).toBeCloseTo(0.7, 12);
    expect(pair?.loser.macros.brightness).toBeCloseTo(0.2, 12);
  });

  test("a tie becomes two half-weighted pairs, one each way, marked as a tie", () => {
    const set = buildTrainingSet({
      ratings: [rating({ id: 4, outcome: "tie", leftSide: "a" })],
      feedback: [],
      genomes,
      features: features([11, 12]),
    });
    expect(
      set.pairs.map((p) => [p.winner.ratedAudioId, p.loser.ratedAudioId, p.weight, p.tie]),
    ).toEqual([
      [11, 12, 0.5, true],
      [12, 11, 0.5, true],
    ]);
    expect(set.pairs.map((p) => p.winnerLeft)).toEqual([true, false]);
  });

  test("a skip and a removed rating are left out", () => {
    const set = buildTrainingSet({
      ratings: [
        rating({ id: 4, outcome: "skip" }),
        rating({ id: 5, outcome: "a", removedAt: 99, removedReason: "undone" }),
        rating({ id: 6, outcome: "a" }),
      ],
      feedback: [],
      genomes,
      features: features([11, 12]),
    });
    expect(set.pairs.map((p) => p.ratingId)).toEqual([6]);
  });

  test("live thumbs are pointwise items; removed thumbs and macro feedback are left out", () => {
    const set = buildTrainingSet({
      ratings: [],
      feedback: [
        thumbs({ id: 7, direction: "up" }),
        thumbs({ id: 8, direction: "down", ratedAudioId: 12, genomeId: 2 }),
        thumbs({ id: 9, direction: "up", removedAt: 99, removedReason: "replaced" }),
        thumbs({ id: 10, kind: "macro", direction: "more", macro: "brightness" }),
      ],
      genomes,
      features: features([11, 12]),
    });
    expect(set.thumbs.map((t) => [t.feedbackId, t.up, t.item.ratedAudioId])).toEqual([
      [7, true, 11],
      [8, false, 12],
    ]);
  });

  test("a side with no features is reported and its rating left out of the pairs", () => {
    const set = buildTrainingSet({
      ratings: [rating({ id: 4, outcome: "a" }), rating({ id: 5, outcome: "b", b: 13 })],
      feedback: [thumbs({ id: 7, ratedAudioId: 13, genomeId: 2 })],
      genomes,
      features: features([11, 12]),
    });
    expect(set.pairs.map((p) => p.ratingId)).toEqual([4]);
    expect(set.thumbs).toEqual([]);
    expect(set.missing).toEqual([
      { ratingId: 5, ratedAudioId: 13 },
      { feedbackId: 7, ratedAudioId: 13 },
    ]);
  });

  test("rows come out in id order whatever order they came in", () => {
    const rows = [rating({ id: 6, outcome: "a" }), rating({ id: 4, outcome: "b" })];
    const set = buildTrainingSet({
      ratings: rows,
      feedback: [],
      genomes,
      features: features([11, 12]),
    });
    expect(set.pairs.map((p) => p.ratingId)).toEqual([4, 6]);
  });

  test("an outcome outside OUTCOMES throws instead of counting as a skip", () => {
    const odd = { ...rating({ id: 4, outcome: "a" }), outcome: "draw" };
    expect(() =>
      buildTrainingSet({ ratings: [odd], feedback: [], genomes, features: features([11, 12]) }),
    ).toThrow('rating 4 has outcome "draw"');
  });

  test("a genome that wasn't given throws, naming the row", () => {
    expect(() =>
      buildTrainingSet({
        ratings: [rating({ id: 4, outcome: "a", bGenomeId: 3 })],
        feedback: [],
        genomes,
        features: features([11, 12]),
      }),
    ).toThrow("rating 4 names genome 3, which wasn't given");
  });
});

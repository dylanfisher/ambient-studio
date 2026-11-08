// The ranking of a session's candidates (decision 0046): by posterior mean, with one slot in
// every eight given to a wildcard drawn from outside the top half under the session's seed.
import { describe, expect, test } from "vitest";
import { rankCandidates, WILDCARD_EVERY } from "../../src/domain/rank-candidates.js";

/** Scores 0..n-1 in a scrambled order, so the order can't come from the input's. @param {number} n */
const scrambled = (n) => Array.from({ length: n }, (_, i) => (i * 7) % n);

describe("rankCandidates", () => {
  test("ranks follow the scores, highest first, and ties go to the earlier item", () => {
    const { rank, wildcard, slot } = rankCandidates([0.2, 1.5, -0.3, 1.5, 0.9], 1);
    expect(rank).toEqual([4, 1, 5, 2, 3]);
    // Fewer than eight candidates have no wildcard, so the slots are the ranks.
    expect(wildcard).toEqual([false, false, false, false, false]);
    expect(slot).toEqual(rank);
  });

  test("one wildcard per eight, each from the bottom half, in slot 4 of its eight", () => {
    for (const n of [8, 15, 16, 24, 31]) {
      for (const seed of [0, 1, 2, 3, 99, 2 ** 31]) {
        const means = scrambled(n);
        const { rank, wildcard, slot } = rankCandidates(means, seed);
        const wild = means.map((_, i) => i).filter((i) => wildcard[i]);
        expect(wild).toHaveLength(Math.floor(n / WILDCARD_EVERY));
        for (const i of wild) expect(rank[i]).toBeGreaterThan(Math.ceil(n / 2));
        const at = (/** @type {number[]} */ list, /** @type {number} */ i) => list[i] ?? 0;
        const wildSlots = wild.map((i) => at(slot, i)).sort((x, y) => x - y);
        expect(wildSlots).toEqual(wild.map((_, k) => WILDCARD_EVERY * k + 4));
        // Every slot is used once, and the rest keep the rank order.
        expect([...slot].sort((x, y) => x - y)).toEqual(means.map((_, i) => i + 1));
        const tame = means.map((_, i) => i).filter((i) => !wildcard[i]);
        const bySlot = [...tame].sort((x, y) => at(slot, x) - at(slot, y));
        expect(bySlot).toEqual([...tame].sort((x, y) => at(rank, x) - at(rank, y)));
      }
    }
  });

  test("the same scores and seed draw the same wildcards, and the seed moves them", () => {
    const means = scrambled(16);
    expect(rankCandidates(means, 5)).toEqual(rankCandidates(means, 5));
    const drawn = new Set(
      Array.from({ length: 20 }, (_, seed) => JSON.stringify(rankCandidates(means, seed).wildcard)),
    );
    expect(drawn.size).toBeGreaterThan(1);
  });

  test("no scores rank nothing", () => {
    expect(rankCandidates([], 1)).toEqual({ rank: [], wildcard: [], slot: [] });
  });
});

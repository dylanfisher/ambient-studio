// The optimizer test's numbers (decision 0059): the share of runs the search wins and the mean
// difference with its interval, checked against counts made by hand; the verdict rule on 4e's
// agreement; the spot-check pairs and the exact binomial test over the owner's choices.
import { describe, expect, test } from "vitest";
import {
  compareRuns,
  MODEL_INCONCLUSIVE,
  modelVerdict,
  OPTIMIZER_TEST,
  OWNER_INCONCLUSIVE,
  ownerTally,
  spotPairs,
  VERDICT,
} from "../../src/domain/optimizer-report.js";
import { rating } from "../support/training-rows.js";

describe("compareRuns", () => {
  test("the win share and the interval match a hand count", () => {
    // By hand: the search wins run 1, loses run 2 and ties run 3, so 1 + 0.5 of 3. The
    // differences are 0.5, -0.25 and 0, a mean of 0.25 / 3. A resample of three runs is all of
    // one run 1 time in 27, more than the 2.5% tail, so the interval's ends are the smallest
    // and largest differences.
    const found = compareRuns([
      { search: 0.75, control: 0.25 },
      { search: 0.25, control: 0.5 },
      { search: 0.5, control: 0.5 },
    ]);
    expect(found).toMatchObject({ compared: 3, wins: 1, ties: 1, share: 0.5 });
    expect(found?.meanDifference).toBeCloseTo(0.25 / 3, 12);
    expect(found?.low).toBe(-0.25);
    expect(found?.high).toBe(0.5);
  });

  test("a run with no scored point in an arm isn't compared", () => {
    const found = compareRuns([
      { search: 1, control: 0 },
      { search: null, control: 0 },
      { search: 1, control: null },
    ]);
    expect(found).toMatchObject({ compared: 1, wins: 1, share: 1, meanDifference: 1 });
    expect(compareRuns([{ search: null, control: 1 }])).toBeNull();
  });

  test("the same runs give the same interval every time", () => {
    const runs = [
      { search: 0.3, control: 0.1 },
      { search: 0.2, control: 0.25 },
      { search: 0.9, control: 0.1 },
    ];
    expect(compareRuns(runs)).toEqual(compareRuns(runs));
  });
});

describe("modelVerdict", () => {
  const strong = compareRuns([
    { search: 2, control: 0 },
    { search: 3, control: 0 },
    { search: 4, control: 0 },
  ]);

  test("a lower agreement bound at or under 0.5 is inconclusive whatever the scores", () => {
    for (const low of [0.5, 0.3]) {
      const found = modelVerdict({ share: 0.9, low, high: 0.95 }, strong);
      expect(found).toEqual({
        counts: false,
        verdict: VERDICT.inconclusive,
        text: MODEL_INCONCLUSIVE,
      });
    }
    expect(modelVerdict(null, strong)).toMatchObject({ counts: false, text: MODEL_INCONCLUSIVE });
    expect(MODEL_INCONCLUSIVE).toBe(
      "inconclusive: the model doesn't yet beat chance on held-out pairs",
    );
  });

  test("above 0.5 it counts, and the interval says which arm is better", () => {
    const agreement = { share: 0.7, low: 0.55, high: 0.82 };
    expect(modelVerdict(agreement, strong)).toMatchObject({
      counts: true,
      verdict: VERDICT.search,
    });
    const worse = compareRuns([
      { search: 0, control: 1 },
      { search: 0, control: 2 },
    ]);
    expect(modelVerdict(agreement, worse)).toMatchObject({
      counts: true,
      verdict: VERDICT.control,
    });
    const mixed = compareRuns([
      { search: 1, control: 0 },
      { search: 0, control: 1 },
    ]);
    expect(modelVerdict(agreement, mixed)).toMatchObject({ counts: true, verdict: VERDICT.even });
    expect(modelVerdict(agreement, null)).toMatchObject({
      counts: false,
      verdict: VERDICT.inconclusive,
    });
  });
});

describe("spotPairs", () => {
  test("pairs each arm's points best to best, as many as the shorter arm has", () => {
    const search = [
      { candidateId: 1, score: 0.1 },
      { candidateId: 2, score: 0.9 },
      { candidateId: 3, score: 0.5 },
    ];
    const control = [
      { candidateId: 11, score: 0.4 },
      { candidateId: 12, score: 0.2 },
    ];
    expect(spotPairs(search, control, 4)).toEqual([
      { rank: 1, search: 2, control: 11 },
      { rank: 2, search: 3, control: 12 },
    ]);
  });

  test("a tie in score goes to the point evaluated first", () => {
    const search = [
      { candidateId: 1, score: 0.5 },
      { candidateId: 2, score: 0.5 },
    ];
    expect(spotPairs(search, search, 1)).toEqual([{ rank: 1, search: 1, control: 1 }]);
  });

  test("three runs of four pairs are the twelve the owner's test needs", () => {
    expect(OPTIMIZER_TEST.runs * OPTIMIZER_TEST.spotPairsPerRun).toBe(OPTIMIZER_TEST.minimumPairs);
  });
});

describe("ownerTally", () => {
  /**
   * A spot pair in session 1 whose search side is genome `2n` and control side `2n + 1`.
   * @param {number} n
   */
  const pair = (n) => ({
    sessionId: 1,
    orderSeed: n,
    search: { candidateId: 100 + n, genomeId: 2 * n, seed: 7 },
    control: { candidateId: 200 + n, genomeId: 2 * n + 1, seed: 7 },
  });

  /**
   * A rating of pair `n` that chose the search (or the control), with the search as side a or b.
   * @param {number} n
   * @param {"search" | "control" | "tie" | "skip"} chose
   * @param {"a" | "b"} [searchSide]
   */
  const rated = (n, chose, searchSide = n % 2 === 0 ? "a" : "b") => {
    const other = searchSide === "a" ? "b" : "a";
    const outcome = chose === "search" ? searchSide : chose === "control" ? other : chose;
    const [aGenomeId, bGenomeId] = searchSide === "a" ? [2 * n, 2 * n + 1] : [2 * n + 1, 2 * n];
    return rating({ id: n + 1, outcome, aGenomeId, bGenomeId, sessionId: 1 });
  };

  const twelve = [...Array(12).keys()].map(pair);

  test("10 of 12 gives p = 0.019, which passes", () => {
    const ratings = twelve.map((_, n) => rated(n, n < 10 ? "search" : "control"));
    const found = ownerTally(twelve, ratings);
    expect(found).toMatchObject({ wins: 10, losses: 2, decided: 12, unrated: 0 });
    // By hand: (C(12,10) + C(12,11) + C(12,12)) / 2^12 = 79 / 4096.
    expect(found.p).toBeCloseTo(79 / 4096, 12);
    expect(found.p?.toFixed(3)).toBe("0.019");
    expect(found.verdict).toBe(VERDICT.search);
  });

  test("11 decided pairs read inconclusive, however one-sided", () => {
    const ratings = twelve.slice(0, 11).map((_, n) => rated(n, "search"));
    const found = ownerTally(twelve, ratings);
    expect(found).toMatchObject({ wins: 11, decided: 11, unrated: 1, p: null });
    expect(found.verdict).toBe(VERDICT.inconclusive);
    expect(OWNER_INCONCLUSIVE).toBe("inconclusive, waiting on data");
  });

  test("ties and skips aren't decided, and 9 of 12 doesn't pass", () => {
    const ratings = [
      ...twelve.map((_, n) => rated(n, n < 9 ? "search" : "control")),
      rated(12, "tie"),
      rated(13, "skip"),
    ];
    const found = ownerTally([...twelve, pair(12), pair(13)], ratings);
    expect(found).toMatchObject({ wins: 9, losses: 3, ties: 1, skips: 1, decided: 12 });
    expect(found.verdict).toBe(VERDICT.even);
  });

  test("a rating counts only in the pair's session with the pair's two sides, the latest one", () => {
    const elsewhere = { ...rated(0, "search"), sessionId: 2 };
    const otherGenome = rating({ id: 50, outcome: "a", aGenomeId: 0, bGenomeId: 99 });
    const first = rated(1, "control");
    const latest = { ...rated(1, "search"), id: 60 };
    const found = ownerTally([pair(0), pair(1)], [elsewhere, otherGenome, first, latest]);
    expect(found).toMatchObject({ wins: 1, losses: 0, decided: 1, unrated: 1 });
  });
});

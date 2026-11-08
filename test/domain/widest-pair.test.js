// The pair picker (decision 0046): of the pairs offered, the one whose score difference has the
// widest posterior variance, var(a) + var(b) − 2 cov(a, b), read from the full covariance.
import { describe, expect, test } from "vitest";
import { differenceVariance, widestPair } from "../../src/domain/widest-pair.js";

// Items 0 and 1 are each uncertain but move together, so their difference is nearly known;
// item 2 is independent of both.
const COVARIANCE = [
  [4, 3.9, 0],
  [3.9, 4, 0],
  [0, 0, 1],
];

describe("differenceVariance", () => {
  test("reads the covariance, not the variances alone", () => {
    expect(differenceVariance(COVARIANCE, 0, 1)).toBeCloseTo(0.2, 12);
    expect(differenceVariance(COVARIANCE, 0, 2)).toBe(5);
  });
});

describe("widestPair", () => {
  test("offers the pair with the widest difference variance", () => {
    // The two most uncertain items make the least informative pair.
    expect(
      widestPair(COVARIANCE, [
        [0, 1],
        [1, 2],
        [0, 2],
      ]),
    ).toEqual([1, 2]);
  });

  test("an equal variance goes to the pair offered first", () => {
    expect(
      widestPair(COVARIANCE, [
        [0, 2],
        [1, 2],
      ]),
    ).toEqual([0, 2]);
  });

  test("with no pair offered, or only pairs of variance 0, there is none", () => {
    expect(widestPair(COVARIANCE, [])).toBeNull();
    expect(
      widestPair(
        [
          [0, 0],
          [0, 0],
        ],
        [[0, 1]],
      ),
    ).toBeNull();
  });

  test("an index outside the covariance throws", () => {
    expect(() => widestPair(COVARIANCE, [[0, 3]])).toThrow(/3/);
  });
});

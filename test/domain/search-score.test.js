// The one objective searches maximize: the model's lower bound (decision 0053).
import { expect, test } from "vitest";
import { SEARCH_KAPPA, searchScore } from "../../src/domain/search-score.js";

test("is the mean less one standard deviation", () => {
  expect(SEARCH_KAPPA).toBe(1);
  expect(searchScore(0.5, 0.04)).toBeCloseTo(0.3, 12);
  expect(searchScore(-1, 0)).toBe(-1);
});

test("orders scripted means and variances by the bound, not by the mean", () => {
  const items = [
    { name: "high mean, unsure", mean: 1.0, variance: 1.0 },
    { name: "middle, sure", mean: 0.6, variance: 0.01 },
    { name: "low, sure", mean: 0.2, variance: 0 },
    { name: "middle, unsure", mean: 0.6, variance: 0.25 },
  ];
  const ranked = [...items]
    .sort((a, b) => searchScore(b.mean, b.variance) - searchScore(a.mean, a.variance))
    .map((item) => item.name);
  // Bounds 0.5, 0.2, 0.1 and 0: the highest mean ranks last.
  expect(ranked).toEqual(["middle, sure", "low, sure", "middle, unsure", "high mean, unsure"]);
});

test.each([
  [Number.NaN, 0],
  [0, -0.1],
  [0, Number.POSITIVE_INFINITY],
])("refuses mean %s and variance %s", (mean, variance) => {
  expect(() => searchScore(mean, variance)).toThrow();
});

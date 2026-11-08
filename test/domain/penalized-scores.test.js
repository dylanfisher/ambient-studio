// What a generation tells its optimizer for a rejected point (decision 0053).
import { expect, test } from "vitest";
import { NO_VALID_SCORE, penalizedScores } from "../../src/domain/penalized-scores.js";

test("a rejected point gets the worst valid score less one standard deviation", () => {
  // Valid 1, 2, 3: worst 1, population standard deviation √(2/3).
  const told = penalizedScores([1, null, 3, 2, null]);
  const penalty = 1 - Math.sqrt(2 / 3);
  expect(told).toEqual([1, penalty, 3, 2, penalty]);
});

test("one valid point makes the penalty its own score", () => {
  expect(penalizedScores([null, 0.4])).toEqual([0.4, 0.4]);
});

test("a generation with no valid point tells −1 for each", () => {
  expect(NO_VALID_SCORE).toBe(-1);
  expect(penalizedScores([null, null])).toEqual([-1, -1]);
});

test("refuses a score that isn't finite", () => {
  expect(() => penalizedScores([1, Number.NaN])).toThrow("finite");
});

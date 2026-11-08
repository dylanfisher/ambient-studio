// What a rating of the best against a new point tells preferential BO (decision 0055).
import { expect, test } from "vitest";
import { EAR_SCORE, earScore } from "../../src/domain/ear-settings.js";

test("the new point's side winning is a win, the other side's a loss, a tie half, a skip nothing", () => {
  expect(earScore("a", "a")).toBe(EAR_SCORE.win);
  expect(earScore("b", "b")).toBe(EAR_SCORE.win);
  expect(earScore("b", "a")).toBe(EAR_SCORE.loss);
  expect(earScore("a", "b")).toBe(EAR_SCORE.loss);
  expect(earScore("tie", "a")).toBe(EAR_SCORE.tie);
  expect(earScore("skip", "b")).toBeNull();
  expect(EAR_SCORE).toEqual({ win: 1, tie: 0.5, loss: 0 });
});

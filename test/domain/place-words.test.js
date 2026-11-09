// Where a value sits among others, the thresholds every description in words reads (decision
// 0085): the share of the others below it, ties counting half, and the five places it falls in.
import { expect, test } from "vitest";
import { MIN_OTHERS, placeOf, shareBelow } from "../../src/domain/place-words.js";

test("the share below counts each tie as half", () => {
  expect(shareBelow(5, [1, 2, 5, 9])).toBe(0.625);
  expect(shareBelow(0, [1, 2])).toBe(0);
  expect(shareBelow(3, [1, 2])).toBe(1);
  expect(() => shareBelow(1, [])).toThrow(/at least one/);
});

test("each threshold falls on the side the record gives it", () => {
  expect(placeOf(1)).toEqual({ side: "above", degree: "nearly all" });
  expect(placeOf(0.9)).toEqual({ side: "above", degree: "nearly all" });
  expect(placeOf(0.89)).toEqual({ side: "above", degree: "most" });
  expect(placeOf(0.7)).toEqual({ side: "above", degree: "most" });
  expect(placeOf(0.69)).toEqual({ side: null, degree: null });
  expect(placeOf(0.5)).toEqual({ side: null, degree: null });
  expect(placeOf(0.31)).toEqual({ side: null, degree: null });
  expect(placeOf(0.3)).toEqual({ side: "below", degree: "most" });
  expect(placeOf(0.11)).toEqual({ side: "below", degree: "most" });
  expect(placeOf(0.1)).toEqual({ side: "below", degree: "nearly all" });
  expect(placeOf(0)).toEqual({ side: "below", degree: "nearly all" });
});

test("a comparison needs a few others", () => {
  expect(MIN_OTHERS).toBe(4);
});

// A candidate's place on each of its brief's directions, in words (decision 0085): seven bands
// over the brief's own scale, 0 its least and 1 its most so far.
import { expect, test } from "vitest";
import { positionsWords, positionWords } from "../../src/domain/position-words.js";

const DRY_WET = { near: "dry", far: "wet" };

test("each band and its edges", () => {
  const words = (/** @type {number | undefined} */ p) => positionWords(DRY_WET, p);
  expect(words(-0.1)).toBe("past “dry”, further than any excerpt of this brief so far");
  expect(words(0)).toBe("close to “dry”");
  expect(words(0.2)).toBe("close to “dry”");
  expect(words(0.21)).toBe("leaning toward “dry”");
  expect(words(0.4)).toBe("leaning toward “dry”");
  expect(words(0.41)).toBe("midway between “dry” and “wet”");
  expect(words(0.59)).toBe("midway between “dry” and “wet”");
  expect(words(0.6)).toBe("leaning toward “wet”");
  expect(words(0.79)).toBe("leaning toward “wet”");
  expect(words(0.8)).toBe("close to “wet”");
  expect(words(1)).toBe("close to “wet”");
  expect(words(1.2)).toBe("past “wet”, further than any excerpt of this brief so far");
  expect(words(undefined)).toBe("not placed yet");
});

test("a direction with no near end names the brief's description", () => {
  expect(positionWords({ near: null, far: "bells" }, 0.1)).toBe("close to the brief's description");
});

test("the line names each direction, and is empty with no direction or no excerpt", () => {
  const directions = [
    { ...DRY_WET, positions: { 7: 0.9 } },
    { near: null, far: "bells", positions: {} },
  ];
  expect(positionsWords(directions, 7)).toBe(
    "On “dry” to “wet”, close to “wet”; on the brief's description to “bells”, not placed yet.",
  );
  expect(positionsWords([], 7)).toBe("");
  expect(positionsWords(directions, null)).toBe("");
});

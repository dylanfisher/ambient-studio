// Which points of a search the session shows (decision 0054): the best by score, no two nearer
// than the stated CLAP distance, and every other point folded under the shown one nearest it.
import { expect, test } from "vitest";
import { MIN_SHOWN_DISTANCE, SHOWN_POINTS, shownPoints } from "../../src/domain/search-shown.js";

/**
 * A unit vector at `angle` radians in a plane: two such sit `1 − cos(Δ)` apart in cosine
 * distance.
 * @param {number} angle
 */
const at = (angle) => [Math.cos(angle), Math.sin(angle)];
/** The angle whose cosine distance from 0 is `distance`. */
const apart = (/** @type {number} */ distance) => Math.acos(1 - distance);

test("the shown 4 follow the score when every point is far enough apart", () => {
  expect(SHOWN_POINTS).toBe(4);
  const scored = [0.1, 0.5, 0.3, 0.9, 0.7, 0.2].map((score, i) => ({
    id: i + 1,
    score,
    embedding: at(i * apart(MIN_SHOWN_DISTANCE * 4)),
  }));
  const { shown } = shownPoints(scored);
  expect(shown).toEqual([4, 5, 2, 3]);
});

test("a point nearer than the distance to a better shown one is folded, and the next is shown", () => {
  const near = apart(MIN_SHOWN_DISTANCE / 2);
  const far = apart(MIN_SHOWN_DISTANCE * 4);
  const scored = [
    { id: 1, score: 0.9, embedding: at(0) },
    { id: 2, score: 0.8, embedding: at(near) }, // too near 1
    { id: 3, score: 0.7, embedding: at(far) },
    { id: 4, score: 0.6, embedding: at(far + near) }, // too near 3
    { id: 5, score: 0.5, embedding: at(2 * far) },
    { id: 6, score: 0.4, embedding: at(3 * far) },
    { id: 7, score: 0.3, embedding: at(4 * far) },
  ];
  const { shown, foldedUnder } = shownPoints(scored);
  expect(shown).toEqual([1, 3, 5, 6]);
  // Each fold goes under the shown point nearest it: 7 is nearest 6.
  expect(Object.fromEntries(foldedUnder)).toEqual({ 2: 1, 4: 3, 7: 6 });
});

test("a tie in score goes to the point evaluated first", () => {
  const scored = [1, 2, 3].map((id) => ({ id, score: 0.5, embedding: at(id) }));
  expect(shownPoints(scored).shown).toEqual([1, 2, 3]);
});

test("fewer points than four are all shown when far enough apart, and none is no error", () => {
  expect(shownPoints([])).toEqual({ shown: [], foldedUnder: new Map() });
  const scored = [
    { id: 8, score: 1, embedding: at(0) },
    { id: 9, score: 2, embedding: at(1) },
  ];
  expect(shownPoints(scored).shown).toEqual([9, 8]);
});

test("refuses a score that isn't finite", () => {
  expect(() => shownPoints([{ id: 1, score: Number.NaN, embedding: at(0) }])).toThrow("finite");
});

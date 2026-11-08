// The pages' pair picker over a session's ranking (decision 0046): candidates named by id, their
// excerpts found in the ranking's covariance by render id.
import { expect, test } from "vitest";
import { questionOf } from "../../src/web/best-question.js";

const RANKING = {
  renderIds: [101, 102, 103],
  // 101 and 102 move together, so the pair of them teaches little.
  covariance: [
    [4, 3.9, 0],
    [3.9, 4, 0],
    [0, 0, 1],
  ],
};
/** @param {number} id @param {number | null} renderId */
const candidate = (id, renderId) => ({ id, excerpt: renderId === null ? null : { renderId } });

test("offers the pair of candidates with the widest difference variance", () => {
  const question = questionOf(RANKING, [candidate(1, 101), candidate(2, 102), candidate(3, 103)]);
  expect(
    question?.([
      [1, 2],
      [1, 3],
      [2, 3],
    ]),
  ).toEqual([1, 3]);
  expect(question?.([[1, 2]])).toEqual([1, 2]);
});

test("a candidate with no place in the ranking is never offered", () => {
  const question = questionOf(RANKING, [candidate(1, 101), candidate(4, 999), candidate(5, null)]);
  expect(
    question?.([
      [1, 4],
      [4, 5],
    ]),
  ).toBeNull();
});

test("two candidates sharing one excerpt are no question", () => {
  const question = questionOf(RANKING, [candidate(1, 101), candidate(6, 101)]);
  expect(question?.([[1, 6]])).toBeNull();
});

test("an unranked session has no picker", () => {
  expect(questionOf(null, [candidate(1, 101)])).toBeNull();
});

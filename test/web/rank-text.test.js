// How the session table shows an excerpt's place in the ranking (decision 0046).
import { expect, test } from "vitest";
import { rankText } from "../../src/web/rank-text.js";

test("names the rank among the ranked excerpts and the score", () => {
  const shown = rankText({ rank: 2, score: 1.534, wildcard: false }, 9);
  expect(shown.text).toBe("Taste #2 of 9, score 1.53");
  expect(shown.title).toMatch(/^Your taste model ranks this excerpt 2nd of 9 in this session/);
  expect(shown.wildcard).toBeNull();
});

test("a wildcard says why it is shown above its rank", () => {
  const shown = rankText({ rank: 8, score: -0.5, wildcard: true }, 9);
  expect(shown.text).toBe("Taste #8 of 9, score -0.50");
  expect(shown.wildcard).toMatch(/bottom half/);
});

test("ordinals read as words do", () => {
  const ordinal = (/** @type {number} */ rank) =>
    /** @type {RegExpExecArray} */ (
      /excerpt (\w+) of/.exec(rankText({ rank, score: 0, wildcard: false }, 30).title)
    )[1];
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "23rd",
  ]);
});

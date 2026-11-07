// A candidate's A/B marks on the session page (decision 0049): one per live win and one per live
// loss in its session, with ties, skips, undone ratings and other sessions left out.
import { expect, test } from "vitest";
import { abMarks, MAX_MARKS, markText } from "../../src/web/ab-marks.js";

const ME = { genomeId: 10, seed: 7 };
const OTHER = { genomeId: 11, seed: 7 };

/**
 * @param {string} outcome
 * @param {{ genomeId: number | null, seed: number }} a
 * @param {{ genomeId: number, seed: number }} b
 * @param {{ sessionId?: number, removedAt?: number | null }} [extra]
 */
const rating = (outcome, a, b, { sessionId = 5, removedAt = null } = {}) => ({
  sessionId,
  outcome,
  a,
  b,
  removedAt,
});

test("counts live wins and losses on either side, and every live rating as compared", () => {
  const ratings = [
    rating("a", ME, OTHER),
    rating("b", OTHER, ME),
    rating("b", ME, OTHER),
    rating("a", ME, OTHER),
    rating("tie", ME, OTHER),
    rating("skip", OTHER, ME),
  ];
  expect(abMarks(ratings, 5, ME)).toEqual({ wins: 3, losses: 1, compared: 6 });
  expect(abMarks(ratings, 5, OTHER)).toEqual({ wins: 1, losses: 3, compared: 6 });
});

test("ties, skips, undone ratings, other sessions and another seed of the genome count nothing", () => {
  const ratings = [
    rating("tie", ME, OTHER),
    rating("skip", ME, OTHER),
    rating("a", ME, OTHER, { removedAt: 1 }),
    rating("a", ME, OTHER, { sessionId: 6 }),
    rating("a", { genomeId: 10, seed: 8 }, OTHER),
  ];
  expect(abMarks(ratings, 5, ME)).toEqual({ wins: 0, losses: 0, compared: 2 });
  expect(abMarks([], 5, ME)).toEqual({ wins: 0, losses: 0, compared: 0 });
});

test("a candidate with no genome has no excerpt to match, and throws", () => {
  const nothing = { genomeId: null, seed: 7 };
  expect(() => abMarks([rating("a", nothing, OTHER)], 5, nothing)).toThrow(/no genome/);
});

test("an outcome the page doesn't know throws", () => {
  expect(() => abMarks([rating("draw", ME, OTHER)], 5, ME)).toThrow(/outcome draw/);
});

test("a mark per count up to the most shown, then one mark with the count", () => {
  expect(markText(0, "▲")).toBe("");
  expect(markText(4, "▲")).toBe("▲▲▲▲");
  expect(markText(MAX_MARKS, "▼")).toBe("▼".repeat(MAX_MARKS));
  expect(markText(MAX_MARKS + 7, "▲")).toBe(`▲×${MAX_MARKS + 7}`);
});

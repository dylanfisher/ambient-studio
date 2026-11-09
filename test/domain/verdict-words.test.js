// The session row's rank and a search point's score as plain verdicts (decision 0085): where
// each sits among the others, in place-words.js's thresholds, never the number itself.
import { expect, test } from "vitest";
import { OPERATOR } from "../../src/domain/operator.js";
import { rankWords, searchScoreWords } from "../../src/domain/verdict-words.js";

test("the rank reads as how much the taste model likes it, at each threshold", () => {
  expect(rankWords(1, 1)).toBe("The only excerpt your taste model has ranked in this session.");
  expect(rankWords(1, 11)).toBe("Your taste model likes it best in this session.");
  expect(rankWords(2, 11)).toBe("Your taste model likes it more than nearly all of this session.");
  expect(rankWords(4, 11)).toBe("Your taste model likes it more than most of this session.");
  expect(rankWords(5, 11)).toBe("Your taste model puts it in the middle of this session.");
  expect(rankWords(7, 11)).toBe("Your taste model puts it in the middle of this session.");
  expect(rankWords(8, 11)).toBe("Your taste model likes it less than most of this session.");
  expect(rankWords(10, 11)).toBe("Your taste model likes it less than nearly all of this session.");
  expect(rankWords(11, 11)).toBe("Your taste model likes it least in this session.");
  expect(() => rankWords(12, 11)).toThrow(/rank 12 of 11/);
});

test("a search point's score reads against the other points of its run", () => {
  const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(searchScoreWords(11, others, OPERATOR.optimize)).toBe("The best point this search found.");
  expect(searchScoreWords(9.5, others, OPERATOR.optimize)).toBe(
    "Scores higher than nearly all of this search's points.",
  );
  expect(searchScoreWords(7.5, others, OPERATOR.steer)).toBe(
    "Scores higher than most of this steer's points.",
  );
  expect(searchScoreWords(5.5, others, OPERATOR.optimize)).toBe(
    "Scores about the middle of this search's points.",
  );
  expect(searchScoreWords(2.5, others, OPERATOR.optimize)).toBe(
    "Scores lower than most of this search's points.",
  );
  expect(searchScoreWords(0, others, OPERATOR.optimize)).toBe(
    "Scores lower than nearly all of this search's points.",
  );
  expect(searchScoreWords(3, [], OPERATOR.steer)).toBe(
    "The only point of this steer with a score on this page.",
  );
});

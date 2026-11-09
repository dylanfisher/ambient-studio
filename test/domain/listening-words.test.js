// How much of an excerpt was played, and how far through its pairs Quick A/B is, in words
// (decision 0086). The shares and counts are behind the numbers toggle.
import { expect, test } from "vitest";
import { pairsLeftWords, playedWords } from "../../src/domain/listening-words.js";

test("the played share reads in five bands", () => {
  expect(playedWords(0)).toBe("not played yet");
  expect(playedWords(0.01)).toBe("played a little of it");
  expect(playedWords(0.3)).toBe("played about half of it");
  expect(playedWords(0.69)).toBe("played about half of it");
  expect(playedWords(0.7)).toBe("played most of it");
  expect(playedWords(0.95)).toBe("played all of it");
  expect(playedWords(1)).toBe("played all of it");
  expect(() => playedWords(1.5)).toThrow(/share 1.5/);
});

test("the pairs left read against the pairs in all, when there is an end", () => {
  expect(pairsLeftWords(20, 20)).toBe("This is the first pair.");
  expect(pairsLeftWords(16, 20)).toBe("Most of the pairs are still to come.");
  expect(pairsLeftWords(10, 20)).toBe("About halfway through the pairs.");
  expect(pairsLeftWords(4, 20)).toBe("Nearly done: a few pairs are left.");
  expect(pairsLeftWords(1, 20)).toBe("This is the last pair.");
  expect(pairsLeftWords(1, null)).toBe("This is the last pair.");
  expect(pairsLeftWords(7, null)).toBe("More pairs come after this one.");
  expect(() => pairsLeftWords(0, 20)).toThrow(/0 pairs left of 20/);
});

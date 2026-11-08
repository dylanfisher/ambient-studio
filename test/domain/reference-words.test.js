// The vocabulary a reference region is described by, and the nearest words by CLAP similarity
// (decision 0052).
import { expect, test } from "vitest";
import {
  nearestWords,
  REFERENCE_WORDS,
  WORDS_PER_REFERENCE,
} from "../../src/domain/reference-words.js";

test("the vocabulary is about 60 different plain lowercase words", () => {
  expect(REFERENCE_WORDS.length).toBeGreaterThanOrEqual(55);
  expect(REFERENCE_WORDS.length).toBeLessThanOrEqual(65);
  expect(new Set(REFERENCE_WORDS).size).toBe(REFERENCE_WORDS.length);
  for (const word of REFERENCE_WORDS) expect(word).toMatch(/^[a-z]+$/);
});

test("gives the five words nearest the sound, nearest first", () => {
  // Each word sits at its own angle from the sound's direction, [1, 0].
  const angles = { dark: 0.5, airy: 0.1, dense: 1.2, slow: 0.3, deep: 0.9, harsh: 2, cold: 0.7 };
  const words = new Map(
    Object.entries(angles).map(([word, angle]) => [
      word,
      new Float32Array([Math.cos(angle), Math.sin(angle)]),
    ]),
  );
  const sound = new Float32Array([2, 0]);
  expect(nearestWords(sound, words)).toEqual(["airy", "slow", "dark", "cold", "deep"]);
  expect(WORDS_PER_REFERENCE).toBe(5);
});

test("words equally near keep the order given, and fewer than five give all", () => {
  const same = new Float32Array([0, 1]);
  const words = new Map([
    ["low", same],
    ["dark", same],
  ]);
  expect(nearestWords(new Float32Array([1, 1]), words)).toEqual(["low", "dark"]);
});

// The track page's reading card (decision 0078), with no DOM: a reading's line split into its
// words and its raw numbers, which the card puts behind the numbers toggle (0083).
import { expect, test } from "vitest";
import { readingParts } from "../../src/web/sketch-reading-card.js";

test("a parenthesized group holding a number is raw numbers; the words around it are not", () => {
  expect(readingParts("Voice drone, a drone: voice level (-10 dB); plays throughout.")).toEqual([
    { text: "Voice drone, a drone: voice level ", numbers: false },
    { text: "(-10 dB)", numbers: true },
    { text: "; plays throughout.", numbers: false },
  ]);
});

test("words in parentheses stay words, and a line with no numbers is one part", () => {
  expect(readingParts("spectral centroid (none measurable), done")).toEqual([
    { text: "spectral centroid (none measurable), done", numbers: false },
  ]);
  expect(readingParts("(0.7) and (2 → 4 s)")).toEqual([
    { text: "(0.7)", numbers: true },
    { text: " and ", numbers: false },
    { text: "(2 → 4 s)", numbers: true },
  ]);
});

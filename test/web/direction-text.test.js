// How the brief and session pages word a direction, a card's positions and a slider's start
// (decision 0056).
import { expect, test } from "vitest";
import { MAX_DIRECTIONS } from "../../src/domain/attachment-kind.js";
import {
  directionHelp,
  directionText,
  positionsLine,
  sliderStart,
} from "../../src/web/direction-text.js";

test("a direction reads its two ends, or the brief's excerpts for no near end", () => {
  expect(directionText({ near: "dry", far: "underwater" })).toBe("“dry” to “underwater”");
  expect(directionText({ near: null, far: "hissing" })).toBe(
    "this brief's excerpts so far to “hissing”",
  );
});

test("a card's line gives its position on each direction, or why it has none", () => {
  const directions = [
    { near: "dry", far: "underwater", reason: null, positions: { 5: 0.625, 6: 1 } },
    { near: null, far: "bright", reason: "a scale needs at least 2 excerpts", positions: {} },
  ];
  expect(positionsLine(directions, 5)).toBe(
    "Where it sits, from 0 (this brief's least) to 1 (its most): “dry” to “underwater” 0.63; this brief's excerpts so far to “bright” not placed yet.",
  );
  // An excerpt rendered since the positions were read waits for the next read.
  expect(positionsLine(directions.slice(0, 1), 9)).toBe(
    "Where it sits, from 0 (this brief's least) to 1 (its most): “dry” to “underwater” not placed yet.",
  );
  expect(positionsLine([], 5)).toBe("");
  expect(positionsLine(directions, null)).toBe("");
});

test("a slider starts at the card's position, held between its ends, or in the middle", () => {
  expect(sliderStart(0.62)).toBe(0.6);
  expect(sliderStart(1.4)).toBe(1);
  expect(sliderStart(-0.2)).toBe(0);
  expect(sliderStart(undefined)).toBe(0.5);
});

test("the brief page's line says how many directions it takes", () => {
  expect(directionHelp(0)).toMatch(`up to ${MAX_DIRECTIONS}`);
  expect(directionHelp(MAX_DIRECTIONS)).toMatch(/the most it takes/);
});

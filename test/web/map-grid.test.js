// The map page's grid (decision 0057), with no DOM: the table's rows from the archive route's
// cells, arrow keys one cell at a time, each cell's words, and the excerpt a cell plays.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  arrowMove,
  axisLine,
  cellAudio,
  cellText,
  coverageText,
  mapRows,
  openText,
} from "../../src/web/map-grid.js";

/** @param {number[]} index @param {Record<string, unknown>} [rest] */
const cell = (index, rest = {}) => ({
  index,
  count: 1,
  candidateId: 10 + index.reduce((sum, bin) => sum * 8 + bin, 0),
  renderId: 70,
  url: "/audio/70",
  intent: "low and still",
  ownIntent: true,
  score: null,
  misses: 0,
  ...rest,
});

test("the grid module holds no DOM, so it runs here", () => {
  const source = readFileSync("src/web/map-grid.js", "utf8");
  expect(source).not.toMatch(/\b(document|window|HTMLElement)\b/);
});

test("the rows run from the second axis's high end down, the columns along the first", () => {
  const map = { shape: [3, 2], cells: [cell([0, 0]), cell([2, 1])] };
  const rows = mapRows(map, 0);
  expect(rows.map(({ bin }) => bin)).toEqual([1, 0]);
  expect(
    rows[0]?.cells.map(({ index, cell: found }) => [index, found?.candidateId ?? null]),
  ).toEqual([
    [[0, 1], null],
    [[1, 1], null],
    [[2, 1], 10 + 2 * 8 + 1],
  ]);
  expect(rows[1]?.cells[0]?.cell?.candidateId).toBe(10);
});

test("a third axis picks the layer the table shows", () => {
  const map = { shape: [2, 2, 3], cells: [cell([1, 0, 2]), cell([1, 0, 0])] };
  const shown = mapRows(map, 2).flatMap(({ cells }) => cells.filter((c) => c.cell !== null));
  expect(shown.map(({ index }) => index)).toEqual([[1, 0, 2]]);
});

test("arrow keys move one cell at a time and stop at the edges; other keys don't move", () => {
  const shape = [8, 8];
  expect(arrowMove([3, 3], "ArrowRight", shape)).toEqual([4, 3]);
  expect(arrowMove([3, 3], "ArrowLeft", shape)).toEqual([2, 3]);
  expect(arrowMove([3, 3], "ArrowUp", shape)).toEqual([3, 4]);
  expect(arrowMove([3, 3], "ArrowDown", shape)).toEqual([3, 2]);
  expect(arrowMove([7, 0], "ArrowRight", shape)).toEqual([7, 0]);
  expect(arrowMove([7, 0], "ArrowDown", shape)).toEqual([7, 0]);
  expect(arrowMove([3, 3, 1], "ArrowUp", [6, 6, 6])).toEqual([3, 4, 1]);
  expect(arrowMove([3, 3], "Enter", shape)).toBeNull();
  expect(arrowMove([3, 3], "a", shape)).toBeNull();
});

test("a filled cell shows its elite's intent and score, an empty one says so", () => {
  expect(cellText(cell([0, 0], { score: 0.4567, count: 3 }), true)).toEqual({
    text: "low and still · 0.46",
    title:
      "Plays the best of the 3 candidates here: “low and still”, search score 0.46 by your taste model. Opens it below, with explore, nudge and keep as sketch.",
  });
  expect(cellText(cell([0, 0], { misses: 2, ownIntent: false }), false)).toEqual({
    text: "from: low and still · 2 misses",
    title:
      "Plays the candidate here: a nudge of one meant as “low and still”, missing 2 of the brief's ranges. Opens it below, with explore, nudge and keep as sketch.",
  });
  expect(cellText(null, false)).toEqual({
    text: "",
    title: "Empty: no candidate lands here yet. Filling the map aims at cells like this one.",
  });
});

test("a cell plays its elite's excerpt, and the open cell says what it holds", () => {
  expect(cellAudio(cell([1, 1], { url: "/audio/42" }))).toBe("/audio/42");
  expect(openText(cell([1, 1], { score: 1.5 }), true)).toBe(
    "The candidate here: “low and still”, search score 1.50 by your taste model.",
  );
});

test("the coverage line counts filled cells over cells, and each axis names its ends", () => {
  expect(coverageText({ filled: 6, total: 64, placed: 9, unplaced: 1 })).toBe(
    "6 of 64 cells filled (9%), from 9 candidates; 1 more can't be placed yet.",
  );
  expect(
    axisLine({ source: "feature", name: "centroidMean", low: 200, high: 1000.123, reason: null }),
  ).toBe("spectral centroid (Hz), from 200 to 1000");
  expect(
    axisLine({
      source: "macro",
      name: "motion",
      low: null,
      high: null,
      reason: "Its ends can't be set yet.",
    }),
  ).toBe("motion (the macro, over the excerpt): Its ends can't be set yet.");
});

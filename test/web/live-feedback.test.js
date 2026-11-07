import { expect, test } from "vitest";
import { liveChoices } from "../../src/web/live-feedback.js";

const heard = { sessionId: 1, genomeId: 10, seed: 5 };

/**
 * @param {number} id
 * @param {string | null} macro
 * @param {string} direction
 * @param {Record<string, unknown>} [rest]
 */
const row = (id, macro, direction, rest = {}) => ({
  id,
  kind: macro === null ? "thumbs" : "macro",
  macro,
  direction,
  createdAt: id * 1000,
  ...heard,
  ...rest,
});

test("nothing chosen yet", () => {
  expect(liveChoices([], heard)).toEqual({ thumbs: null, macros: {} });
});

test("the latest row per macro wins, so more then less reads as less", () => {
  const first = row(1, "brightness", "more");
  const second = row(2, "brightness", "less");
  const warmth = row(3, "warmth", "more");
  expect(liveChoices([first, second, warmth], heard)).toEqual({
    thumbs: null,
    macros: { brightness: second, warmth },
  });
});

test("the latest thumbs wins, apart from the macros", () => {
  const up = row(1, null, "up");
  const down = row(4, null, "down");
  expect(liveChoices([down, up, row(2, "space", "less")], heard).thumbs).toBe(down);
});

test("rows of another candidate or another session don't count", () => {
  const rows = [
    row(1, null, "up", { genomeId: 11 }),
    row(2, null, "up", { seed: 6 }),
    row(3, null, "up", { sessionId: 2 }),
  ];
  expect(liveChoices(rows, heard)).toEqual({ thumbs: null, macros: {} });
});

test("rows made in the same millisecond order by id", () => {
  const more = row(7, "motion", "more", { createdAt: 5000 });
  const less = row(8, "motion", "less", { createdAt: 5000 });
  expect(liveChoices([less, more], heard).macros.motion).toBe(less);
});

// The timeline's layout (decision 0061), with no DOM: each section a block placed and sized by
// its time on the track, each crossfade the overlap of two blocks, and each block's words.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { blockText, dragSeconds, timelineLayout } from "../../src/web/timeline-layout.js";

const ARRANGEMENT = {
  ...emptyArrangement(),
  sections: [
    { sketchId: 1, offset: 10, seconds: 40, text: "", developmentId: null },
    { sketchId: 2, offset: 0, seconds: 70, text: "", developmentId: null },
  ],
  transitions: [{ kind: "crossfade", seconds: 10, text: "" }],
};

test("the layout module holds no DOM, so it runs here", () => {
  const source = readFileSync("src/web/timeline-layout.js", "utf8");
  expect(source).not.toMatch(/document|window\./);
});

test("blocks sit at their time on the track, overlapping by each crossfade", () => {
  expect(timelineLayout(ARRANGEMENT)).toEqual({
    length: 100,
    blocks: [
      { start: 0, end: 40, left: 0, width: 40 },
      { start: 30, end: 100, left: 30, width: 70 },
    ],
    fades: [{ start: 30, end: 40, left: 30, width: 10 }],
  });
});

test("an empty track has no blocks", () => {
  expect(timelineLayout(emptyArrangement())).toEqual({ length: 0, blocks: [], fades: [] });
});

test("a drag across the timeline is its share of the track's length, to a tenth of a second", () => {
  expect(dragSeconds(50, 500, 100)).toBe(10);
  expect(dragSeconds(-33, 1000, 100)).toBe(-3.3);
  expect(dragSeconds(10, 0, 100)).toBe(0);
});

test("a block says its sketch, its intent and the part of the sketch it plays", () => {
  const sketch = { id: 1, intent: "a slow cold drone", duration: 60 };
  expect(
    blockText({ sketchId: 1, offset: 10, seconds: 40, text: "", developmentId: null }, sketch),
  ).toEqual({
    name: "Sketch 1: a slow cold drone",
    times: "0:10 to 0:50 of its 1:00, 40 s",
    words: "",
  });
  expect(
    blockText({ sketchId: 1, offset: 30, seconds: 60, text: "", developmentId: null }, sketch)
      .times,
  ).toBe("0:30 to 1:30 of its 1:00, 60 s; extended by 0:30 past its end");
  expect(
    blockText(
      { sketchId: 1, offset: 0, seconds: 60, text: "", developmentId: null },
      { ...sketch, intent: null },
    ).name,
  ).toBe("Sketch 1");
  expect(
    blockText({ sketchId: 9, offset: 0, seconds: 60, text: "", developmentId: null }, undefined),
  ).toEqual({
    name: "Sketch 9, no longer kept",
    times: "0:00 to 1:00, 60 s",
    words: "",
  });
});

test("a developed block says so, and plays a part of its development (0079)", () => {
  const sketch = { id: 1, intent: "a slow cold drone", duration: 60 };
  const section = { sketchId: 1, offset: 0, seconds: 240, text: "", developmentId: 3 };
  expect(blockText(section, sketch, { seconds: 240 })).toEqual({
    name: "Sketch 1: a slow cold drone, developed",
    times: "0:00 to 4:00 of its development's 4:00, 240 s",
    words: "",
  });
  expect(blockText({ ...section, seconds: 300 }, sketch, { seconds: 240 }).times).toBe(
    "0:00 to 5:00 of its development's 4:00, 300 s; extended by 1:00 past its end",
  );
});

test("a block shows the start of its section's text, cut at a word", () => {
  const sketch = { id: 1, intent: null, duration: 60 };
  /** @param {string} text */
  const words = (text) =>
    blockText({ sketchId: 1, offset: 0, seconds: 30, text, developmentId: null }, sketch).words;
  expect(words("the bell comes forward")).toBe("the bell comes forward");
  expect(words("start almost silent, then let the hiss open out slowly until the end")).toBe(
    "start almost silent, then let the hiss…",
  );
  expect(words("rise\nthen fall")).toBe("rise then fall");
  expect(words("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
});

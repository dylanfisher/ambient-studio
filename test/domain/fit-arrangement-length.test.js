// Fitting a proposed arrangement to the length asked for (decision 0067's amendment).
import { expect, test } from "vitest";
import { arrangementLength } from "../../src/domain/arrangement-length.js";
import { fitArrangementLength } from "../../src/domain/fit-arrangement-length.js";

/** @param {number[]} seconds each section's */
const arrangement = (seconds) => ({
  length: null,
  arc: null,
  sections: seconds.map((s) => ({ sketchId: 7, offset: 0, seconds: s, text: "" })),
  transitions: seconds
    .slice(1)
    .map(() => ({ kind: /** @type {const} */ ("crossfade"), seconds: 10, text: "" })),
  lanes: [
    {
      macro: /** @type {const} */ ("density"),
      points: /** @type {any} */ ([
        [0, 0],
        [140, 0.3, "linear"],
        [280, -0.2, "linear"],
      ]),
    },
  ],
  proposal: null,
});

test("sections that forgot the overlap scale to play the length exactly", () => {
  // 100 + 100 + 100 less two 10 s crossfades plays 280 s.
  const fitted = fitArrangementLength(arrangement([100, 100, 100]), 300);
  if (!fitted) throw new Error("not fitted");
  expect(arrangementLength(fitted)).toBe(300);
  expect(fitted.sections.map(({ seconds }) => seconds)).toEqual([107, 107, 106]);
  expect(fitted.transitions).toEqual(arrangement([100, 100, 100]).transitions);
});

test("lane times scale with the track, keeping their offsets and curves", () => {
  const fitted = fitArrangementLength(arrangement([100, 100, 100]), 300);
  expect(fitted?.lanes[0]?.points).toEqual([
    [0, 0],
    [150, 0.3, "linear"],
    [300, -0.2, "linear"],
  ]);
});

test("more than 25% off is left to the model", () => {
  expect(fitArrangementLength(arrangement([100, 100, 100]), 400)).toBeNull();
  expect(fitArrangementLength(arrangement([100, 100, 100]), 200)).toBeNull();
  expect(fitArrangementLength(arrangement([100, 100, 100]), 345)).not.toBeNull();
});

// A search's cost estimate (decision 0054): evaluations times the render and embed seconds, from
// the last run's medians or the bench before any.
import { expect, test } from "vitest";
import {
  BENCH_SECONDS,
  fillCostText,
  medianTimings,
  optimizerTestCostText,
  searchCostText,
  searchSeconds,
  steerCostText,
  wallShares,
} from "../../src/domain/search-cost.js";

test("the estimate is evaluations times the render and embed seconds", () => {
  expect(searchSeconds(96, { render: 2.5, embed: 0.5 })).toBe(288);
  expect(searchSeconds(10, BENCH_SECONDS)).toBeCloseTo(10 * (2 + 0.17));
});

test("the medians are each step's own, nearest rank", () => {
  const timings = [
    { render: 3, embed: 0.2 },
    { render: 1, embed: 0.4 },
    { render: 2, embed: 0.1 },
    { render: 9, embed: 0.3 },
  ];
  expect(medianTimings(timings)).toEqual({ render: 2, embed: 0.2 });
  expect(() => medianTimings([])).toThrow();
});

test("evaluations run side by side each get their share of the batch's wall time", () => {
  const timings = [
    { render: 3, embed: 1 },
    { render: 2, embed: 2 },
  ];
  // 8 s of renders and embeds that overlapped into 4 s of wall time.
  expect(wallShares(timings, 4)).toEqual([
    { render: 1.5, embed: 0.5 },
    { render: 1, embed: 1 },
  ]);
  expect(wallShares([{ render: 0, embed: 0 }], 0)).toEqual([{ render: 0, embed: 0 }]);
});

test("the confirm says the cost, where its figures come from, and that it uses no omlx", () => {
  const measured = searchCostText(
    96,
    { render: 2.5, embed: 0.5 },
    { measured: true, control: false },
  );
  expect(measured).toBe(
    "Search from this candidate with 96 evaluations? Each renders an excerpt, analyzes its sound and scores it by your taste model; nothing is sent to the language model. That is about 5 minutes, at 2.5 s to render and 0.5 s to analyze each, the medians of the last search.",
  );
  const bench = searchCostText(40, BENCH_SECONDS, { measured: false, control: true });
  expect(bench).toBe(
    "Search from this candidate with 40 evaluations, then 40 medium nudges of it as a control that isn't shown? Each renders an excerpt, analyzes its sound and scores it by your taste model; nothing is sent to the language model. That is about 3 minutes, at 2 s to render and 0.17 s to analyze each, from the bench, since no search has run yet.",
  );
});

test("a steer's confirm says it scores by the sliders and regions, the taste model only a little", () => {
  expect(steerCostText(32, { render: 2.5, embed: 0.5 }, { measured: true })).toBe(
    "Steer from this candidate with 32 evaluations? Each renders an excerpt, analyzes its sound and scores it by where it sits on the sliders you moved and how near it is to the regions you chose, and a little by your taste model when the brief has one; nothing is sent to the language model. That is about 2 minutes, at 2.5 s to render and 0.5 s to analyze each, the medians of the last search.",
  );
});

test("the map's fill confirm gives both arms' time, and states the model requests its explore steps make", () => {
  const seconds = { render: 2, embed: 0.5 };
  expect(fillCostText(200, 0, seconds, { measured: true, control: true })).toBe(
    "Fill the map with 200 steps, then 200 medium nudges from the same starts as a control that isn't shown? Each nudges a candidate beside an empty cell, renders the excerpt and places it on the map. Nothing is sent to the language model. That is about 17 minutes, at 2 s to render and 0.5 s to analyze each, the medians of the last search.",
  );
  expect(fillCostText(20, 5, seconds, { measured: false, control: false })).toBe(
    "Fill the map with 20 steps? Each nudges a candidate beside an empty cell, renders the excerpt and places it on the map. 5 steps of them ask the language model for a variation, 5 requests to it, which wait their turn and add their own time. That is about 1 minute, at 2 s to render and 0.5 s to analyze each, from the bench, since no search has run yet.",
  );
});

test("the optimizer test's confirm counts every brief's runs and both arms of each", () => {
  // 2 briefs × 3 runs × 2 arms × 96 = 1152 evaluations at 2.5 s: 48 minutes.
  expect(optimizerTestCostText(2, 3, 96, { render: 2, embed: 0.5 }, { measured: true })).toBe(
    "Run the optimizer test on 2 briefs? Each brief gets 3 searches of 96 evaluations, each followed by 96 medium nudges of the same start as its control, 1152 evaluations in all. Each renders an excerpt, analyzes its sound and scores it by your taste model; nothing is sent to the language model. That is about 48 minutes, at 2 s to render and 0.5 s to analyze each, the medians of the last search.",
  );
  expect(optimizerTestCostText(1, 3, 10, BENCH_SECONDS, { measured: false })).toMatch(
    /^Run the optimizer test on 1 brief\? .* 60 evaluations in all\. .*from the bench/,
  );
});

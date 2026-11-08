// A search's cost estimate (decision 0054): evaluations times the render and embed seconds, from
// the last run's medians or the bench before any.
import { expect, test } from "vitest";
import {
  BENCH_SECONDS,
  medianTimings,
  searchCostText,
  searchSeconds,
  steerCostText,
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

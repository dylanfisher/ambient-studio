// The optimizer test's report in plain words (decisions 0032 and 0059).
import { describe, expect, test } from "vitest";
import {
  compareRuns,
  modelVerdict,
  ownerTally,
  VERDICT,
} from "../../src/domain/optimizer-report.js";
import {
  baseIds,
  modelText,
  optimizerFacts,
  optimizerSummary,
  ownerText,
} from "../../src/web/optimizer-test-text.js";

const runs = [
  { search: { score: 0.5 }, control: { score: 0.2 }, baseId: 4, sessionId: 2 },
  { search: { score: 0.4 }, control: { score: 0.1 }, baseId: 4, sessionId: 2 },
  { search: { score: 0.6 }, control: { score: 0.3 }, baseId: 9, sessionId: 3 },
];
const model = compareRuns(runs.map((r) => ({ search: r.search.score, control: r.control.score })));
const agreement = { share: 0.75, low: 0.6, high: 0.9, scored: 40 };
const noChoices = ownerTally([], []);

/** @param {object} overrides */
const tested = (overrides) => ({
  leftOut: null,
  agreement,
  runs,
  model,
  verdict: modelVerdict(agreement, model),
  spotChecks: [{}],
  owner: { ...noChoices, unrated: 12 },
  coverage: null,
  timings: {
    estimate: { seconds: 600, perEvaluation: { render: 2, embed: 0.17 }, measured: false },
    took: { seconds: 480, evaluations: 576, perEvaluation: { render: 1.5, embed: 0.25 } },
  },
  ...overrides,
});

describe("modelText", () => {
  test("a counted comparison gives the wins, the mean difference and its interval", () => {
    expect(modelText(tested({}))).toBe(
      "By your taste model, the search's best beat the control's in 3 of 3 searches. On average it scored 0.30 more, probably between 0.30 and 0.30. The search is better.",
    );
  });

  test("a low agreement bound reads inconclusive, with the bound", () => {
    const low = { ...agreement, low: 0.45 };
    expect(modelText(tested({ agreement: low, verdict: modelVerdict(low, model) }))).toBe(
      "By your taste model: inconclusive: the model doesn't yet beat chance on held-out pairs (its held-out agreement is probably between 45% and 90%, and must be above 50% at the low end).",
    );
    expect(modelText(tested({ agreement: null, verdict: modelVerdict(null, model) }))).toMatch(
      /run Test your taste model above\)\.$/,
    );
  });
});

describe("ownerText", () => {
  test("below 12 decided pairs it is waiting on data", () => {
    expect(ownerText(tested({}))).toBe(
      "By ear: inconclusive, waiting on data. You chose the search's side in 0 of 0 decided pairs, and the test needs 12; 12 pairs are still to rate.",
    );
  });

  test("at 12 it gives the p and what it shows", () => {
    const passed = { ...noChoices, wins: 10, decided: 12, p: 79 / 4096, verdict: VERDICT.search };
    expect(ownerText(tested({ owner: passed }))).toBe(
      "By ear, you chose the search's side in 10 of 12 pairs: p = 0.019, so the search is better by ear.",
    );
    const failed = { ...passed, wins: 9, p: 0.073, verdict: VERDICT.even };
    expect(ownerText(tested({ owner: failed }))).toMatch(/doesn't show the search is better/);
  });
});

test("a brief left out says why, with no facts", () => {
  const out = tested({ leftOut: "This brief has no taste model yet." });
  expect(optimizerSummary(out)).toBe("Left out: This brief has no taste model yet.");
  expect(optimizerFacts(out)).toEqual([]);
});

test("the facts list each search, the map's coverage and the time against the estimate", () => {
  const coverage = { cells: 64, coverage: { start: 0.1, fill: 0.5, control: 0.3 } };
  expect(optimizerFacts(tested({ coverage }))).toEqual([
    ["Search 1", "best 0.50 against the control's 0.20, from candidate #4 in session 2"],
    ["Search 2", "best 0.40 against the control's 0.10, from candidate #4 in session 2"],
    ["Search 3", "best 0.60 against the control's 0.30, from candidate #9 in session 3"],
    [
      "Map coverage",
      "the last fill filled 50% of 64 cells, the same number of nudges 30%, from 10% at the start",
    ],
    [
      "Time",
      "8 minutes for 576 excerpts, at 1.5 s to render and 0.25 s to analyze each; the estimate was 10 minutes",
    ],
  ]);
});

test("the bases typed for a brief are up to 3 candidate numbers, none for the top-ranked", () => {
  expect(baseIds("", "cold drone")).toEqual([]);
  expect(baseIds(" #12, 15 3 ", "cold drone")).toEqual([12, 15, 3]);
  expect(() => baseIds("12, x", "cold drone")).toThrow(
    "cold drone: x isn't a candidate number. Type numbers such as 12, 15.",
  );
  expect(() => baseIds("1 2 3 4", "cold drone")).toThrow(/at most 3 candidates/);
});

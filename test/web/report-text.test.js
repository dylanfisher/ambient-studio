import { describe, expect, test } from "vitest";
import { evaluationReport } from "../../src/domain/evaluation-report.js";
import {
  meaningText,
  rangeText,
  rateText,
  rejectsText,
  responseFormatText,
  revisionFacts,
  revisionVerdictText,
  revisionVerdictWords,
  timeText,
} from "../../src/web/report-text.js";

/**
 * A one-brief report from each candidate's first and final reject reason.
 * @param {[string | null, string | null][]} reasons
 */
function reportOf(reasons) {
  return evaluationReport({
    runs: [
      {
        vibeId: 1,
        revisionId: 1,
        name: "bells",
        requestGroup: "vibe-1-stream-1",
        requested: reasons.length,
        outcomes: reasons.map(([firstReason, finalReason]) => ({
          firstReason: /** @type {any} */ (firstReason),
          finalReason: /** @type {any} */ (finalReason),
        })),
        timings: [],
        ranges: {},
        revision: null,
      },
    ],
    responseFormat: "notSent",
    stopped: null,
  });
}

/**
 * @param {number} n
 * @param {[string | null, string | null]} pair
 * @returns {[string | null, string | null][]}
 */
const times = (n, pair) => Array.from({ length: n }, () => pair);

describe("a rate in plain words", () => {
  const { overall } = reportOf([
    ...times(45, [null, null]),
    ...times(3, ["lintErrors", "lintErrors"]),
  ]);

  test("reads as a count and a percentage", () => {
    expect(rateText(overall.valid.afterRepair)).toBe("45 of 48 (94%)");
    expect(rateText(null)).toBe("nothing answered");
  });

  test("its range says what the true rate probably is, with this few tries", () => {
    expect(rangeText(overall.valid.afterRepair)).toBe(
      "With this few tries, the true rate is probably between 83% and 98%.",
    );
    expect(rangeText(null)).toBe("");
  });
});

test("time per request reads as the usual, the slow and the slowest", () => {
  expect(timeText({ count: 16, p50: 54_000, p90: 61_400, p95: 65_000, max: 70_200 })).toBe(
    "Usually 54 s (half were quicker); 9 in 10 within 61 s; the slowest took 70 s. 16 timed.",
  );
  expect(timeText(null)).toBe("None timed.");
});

test("reasons for failing read as what went wrong, and only those that happened", () => {
  expect(rejectsText({ noJson: 1, invalidJson: 0, schemaErrors: 14, lintErrors: 2 })).toBe(
    "14 used a field name or value the format doesn't allow; 2 broke one of the brief's rules; 1 had no JSON in it.",
  );
  expect(rejectsText({ noJson: 0 })).toBe("None.");
  expect(() => rejectsText({ mystery: 1 })).toThrow(/mystery/);
});

test("whether the model was asked for JSON format reads as one of three answers", () => {
  expect(responseFormatText("notSent")).toMatch(/^Model was asked for JSON format: not sent\./);
  expect(responseFormatText("accepted")).toMatch(/^Model was asked for JSON format: accepted\./);
  expect(responseFormatText("refused")).toMatch(/^Model was asked for JSON format: refused\./);
  expect(responseFormatText("noAnswer")).toMatch(/^Model was asked for JSON format: no answer/);
  expect(() => responseFormatText(/** @type {any} */ ("maybe"))).toThrow(/maybe/);
});

describe("what a result means", () => {
  test("low first time, high after one fix: it understands but makes a format mistake", () => {
    const { overall } = reportOf([...times(2, [null, null]), ...times(14, ["schemaErrors", null])]);
    expect(meaningText(overall)).toMatch(
      /^A low first-time rate with a high after-fix rate means the model understands the brief but keeps making a format mistake/,
    );
  });

  test("high first time: it follows the brief", () => {
    expect(meaningText(reportOf(times(16, [null, null])).overall)).toMatch(/^The model follows/);
  });

  test("right format but the brief's rules broken: the rules or description need work", () => {
    const { overall } = reportOf(times(16, ["lintErrors", "lintErrors"]));
    expect(meaningText(overall)).toMatch(/breaks the brief's rules/);
  });

  test("wrong format even after a fix: it struggles with the format", () => {
    const { overall } = reportOf(times(16, ["schemaErrors", "schemaErrors"]));
    expect(meaningText(overall)).toMatch(/format/);
  });

  test("cut-off answers are named", () => {
    const { overall } = reportOf([
      ...times(14, [null, null]),
      ...times(2, ["truncated", "truncated"]),
    ]);
    expect(meaningText(overall)).toMatch(/Some answers were cut off/);
    expect(meaningText(overall)).not.toMatch(/\d/);
  });

  test("nothing answered says there is nothing to judge", () => {
    const { overall } = reportOf(times(2, ["requestFailed", "requestFailed"]));
    expect(meaningText(overall)).toMatch(/^No answer came back/);
  });
});

// Revision mode (decision 0040).
/**
 * A one-brief revision-mode report: `fits` first tries inside, then pairs of [treatment,
 * control] inside.
 * @param {number} fits
 * @param {[boolean, boolean][]} pairs
 */
function revisionReportOf(fits, pairs) {
  const arm = (/** @type {boolean} */ inside) => ({
    inside,
    unchanged: false,
    overBudget: false,
    rejected: false,
  });
  /** @type {import("../../src/domain/evaluation-report.js").FirstTryOutcome[]} */
  const firstTries = [
    ...Array.from({ length: fits }, () => ({
      inside: /** @type {const} */ (true),
      treatment: null,
      control: null,
    })),
    ...pairs.map(([t, c]) => ({
      inside: /** @type {const} */ (false),
      treatment: arm(t),
      control: arm(c),
    })),
  ];
  return evaluationReport({
    runs: [
      {
        vibeId: 1,
        revisionId: 4,
        name: "bells",
        requestGroup: "vibe-1-stream-1",
        ranges: { lowEndShare: [null, 0.5] },
        requested: firstTries.length,
        outcomes: firstTries.map(() => ({ firstReason: null, finalReason: null })),
        timings: [],
        revision: { firstTries, timings: { treatment: [], control: [] } },
      },
    ],
    responseFormat: "notSent",
    stopped: null,
  });
}

/** @param {number} n @param {[boolean, boolean]} pair */
const pairs = (n, pair) => Array.from({ length: n }, () => pair);

describe("the revision test in plain words", () => {
  test("a report stored before revision mode, without its fields, has no revision facts", () => {
    // The shape a report had before 0040: no `revision`, `ranges` or `revisionTiming`.
    const old = {
      requested: 16,
      made: 16,
      answered: 16,
      valid: {
        beforeRepair: { count: 15, of: 16, share: 0.9375, low: 0.72, high: 0.99 },
        afterRepair: { count: 16, of: 16, share: 1, low: 0.81, high: 1 },
      },
      schemaValid: {
        beforeRepair: { count: 16, of: 16, share: 1, low: 0.81, high: 1 },
        afterRepair: { count: 16, of: 16, share: 1, low: 0.81, high: 1 },
      },
      truncated: 0,
      requestFailed: 0,
      rejects: { firstTry: {}, afterRepair: {} },
    };
    expect(revisionFacts(/** @type {any} */ (old))).toBeNull();
    expect(revisionVerdictText(/** @type {any} */ (old))).toBeNull();
    expect(meaningText(/** @type {any} */ (old))).toMatch(/^The model follows/);
  });

  test("below 20 revised first tries the verdict is inconclusive and gives no p", () => {
    const { overall } = revisionReportOf(2, pairs(10, [true, false]));
    expect(revisionVerdictText(overall)).toMatch(/^Inconclusive: only 10 first tries/);
    expect(revisionVerdictText(overall)).not.toMatch(/p =/);
  });

  test("a pass says the measurements help, with its p", () => {
    const { overall } = revisionReportOf(4, [
      ...pairs(5, [true, true]),
      ...pairs(9, [true, false]),
      [false, true],
      ...pairs(5, [false, false]),
    ]);
    expect(revisionVerdictText(overall)).toMatch(/^The measurements help/);
    expect(revisionVerdictText(overall)).toContain("p = 0.011");
    const facts = Object.fromEntries(/** @type {[string, string][]} */ (revisionFacts(overall)));
    expect(facts["Inside every range, first tries"]).toMatch(/^4 of 24 \(17%\)/);
    expect(facts["Inside after revising with the measurements"]).toMatch(/^14 of 20/);
    expect(facts["Inside after revising without them"]).toMatch(/^6 of 20/);
    expect(facts["Which revisions landed inside"]).toBe(
      "both: 5; only the one with the measurements: 9; only the one without: 1; neither: 5.",
    );
    expect(facts["Paired test"]).toBe(
      "p = 0.011: the chance of a split at least this lopsided toward the measurements if they made no difference",
    );
  });

  test("a fix that doesn't beat the control says the gain comes from asking again", () => {
    const { overall } = revisionReportOf(0, [
      ...pairs(6, [true, false]),
      ...pairs(6, [false, true]),
      ...pairs(8, [false, false]),
    ]);
    expect(revisionVerdictText(overall)).toMatch(/^The gain comes from asking again/);
    expect(revisionVerdictWords(overall)).toBe(
      "The gain comes from asking again: the revision told its measurements fixed some first tries, but not clearly more than the revision that wasn't told them. The measurements don't earn their place yet; decide whether to keep the revision step.",
    );
  });

  test("each verdict reads in words alone, with the counts and p behind the numbers", () => {
    expect(revisionVerdictWords(revisionReportOf(2, pairs(10, [true, false])).overall)).toBe(
      "Inconclusive: too few first tries missed a range to tell. Run it again with more candidates per brief.",
    );
    const passes = revisionReportOf(4, [
      ...pairs(5, [true, true]),
      ...pairs(9, [true, false]),
      [false, true],
      ...pairs(5, [false, false]),
    ]).overall;
    expect(revisionVerdictWords(passes)).toBe(
      "The measurements help: the revision that was told its measurements landed inside every range more often than the one that wasn't.",
    );
    expect(revisionVerdictWords(revisionReportOf(0, pairs(20, [false, false])).overall)).toBe(
      "The revision step didn't help: the revision told its measurements fixed none of the first tries.",
    );
    expect(revisionVerdictWords(reportOf(times(4, [null, null])).overall)).toBeNull();
  });

  test("a brief's card names the ranges the test used", () => {
    const [vibe] = revisionReportOf(1, [[true, false]]).vibes;
    const facts = Object.fromEntries(
      /** @type {[string, string][]} */ (revisionFacts(/** @type {any} */ (vibe))),
    );
    expect(facts["Ranges this test used"]).toBe("low-end share at most 0.5 (brief version 4)");
  });
});

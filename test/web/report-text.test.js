import { describe, expect, test } from "vitest";
import { evaluationReport } from "../../src/domain/evaluation-report.js";
import {
  meaningText,
  rangeText,
  rateText,
  rejectsText,
  responseFormatText,
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
    expect(meaningText(overall)).toMatch(/2 answers were cut off/);
  });

  test("nothing answered says there is nothing to judge", () => {
    const { overall } = reportOf(times(2, ["requestFailed", "requestFailed"]));
    expect(meaningText(overall)).toMatch(/^No answer came back/);
  });
});

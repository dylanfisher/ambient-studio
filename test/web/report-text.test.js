import { describe, expect, test } from "vitest";
import { evaluationReport } from "../../src/domain/evaluation-report.js";
import {
  percentilesText,
  rateText,
  rejectsText,
  responseFormatText,
} from "../../src/web/report-text.js";

describe("the report's text", () => {
  test("a rate shows the count, the share and its 95% interval", () => {
    const report = evaluationReport({
      runs: [
        {
          vibeId: 1,
          revisionId: 1,
          name: "bells",
          requestGroup: "vibe-1-stream-1",
          requested: 48,
          outcomes: Array.from({ length: 48 }, (_, i) => ({
            firstReason: i < 45 ? null : "lintErrors",
            finalReason: i < 45 ? null : "lintErrors",
          })),
          timings: [],
        },
      ],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(rateText(report.overall.valid.afterRepair)).toBe("45/48, 93.8% (95% CI 83.2–97.9%)");
    expect(rateText(null)).toBe("nothing answered");
  });

  test("percentiles read in seconds, with how many were measured", () => {
    expect(percentilesText({ count: 48, p50: 1200, p90: 3450, p95: 4000, max: 51000 })).toBe(
      "p50 1.2 s, p90 3.5 s, p95 4.0 s, max 51.0 s (48 measured)",
    );
    expect(percentilesText(null)).toBe("nothing measured");
  });

  test("reject counts list only the reasons that occurred", () => {
    expect(rejectsText({ noJson: 1, invalidJson: 0, lintErrors: 2 })).toBe(
      "noJson 1, lintErrors 2",
    );
    expect(rejectsText({ noJson: 0 })).toBe("no rejects");
  });

  test("each response_format outcome reads as a sentence", () => {
    for (const result of ["accepted", "refused", "notSent", "noAnswer"]) {
      expect(responseFormatText(/** @type {any} */ (result))).toMatch(/response_format/);
    }
    expect(() => responseFormatText(/** @type {any} */ ("maybe"))).toThrow(/maybe/);
  });
});

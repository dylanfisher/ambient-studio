import { describe, expect, test } from "vitest";
import { evaluationReport } from "../../src/domain/evaluation-report.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";

const R = REJECT_REASON;

/**
 * @param {import("../../src/domain/reject-reason.js").RejectReason | null} firstReason
 * @param {import("../../src/domain/reject-reason.js").RejectReason | null} finalReason
 */
const outcome = (firstReason, finalReason = firstReason) => ({ firstReason, finalReason });

/** @param {number} latencyMs @param {number} [repairRound] */
const timing = (latencyMs, repairRound = 0) => ({
  repairRound,
  latencyMs,
  firstTokenMs: latencyMs / 10,
  failed: false,
  reasoned: true,
});

/** @param {number} vibeId @param {ReturnType<typeof outcome>[]} outcomes @param {number} [requested] */
const run = (vibeId, outcomes, requested = outcomes.length) => ({
  vibeId,
  revisionId: vibeId * 10,
  name: `vibe ${vibeId}`,
  requestGroup: `vibe-${vibeId}-stream-7`,
  requested,
  outcomes,
  timings: outcomes.map((_, i) => timing(1000 * (i + 1))),
});

describe("evaluationReport", () => {
  test("valid and schema-only rates before and after repair, per vibe and overall", () => {
    const report = evaluationReport({
      runs: [
        run(1, [outcome(null), outcome(R.lintErrors, null), outcome(R.truncated)]),
        run(2, [outcome(R.schemaErrors, R.lintErrors), outcome(R.lintErrors), outcome(R.noJson)]),
      ],
      responseFormat: "notSent",
      stopped: null,
    });
    const [first, second] = report.vibes;
    expect(first).toMatchObject({
      vibeId: 1,
      revisionId: 10,
      name: "vibe 1",
      requestGroup: "vibe-1-stream-7",
      requested: 3,
      answered: 3,
      truncated: 1,
      requestFailed: 0,
      valid: {
        beforeRepair: { count: 1, of: 3 },
        afterRepair: { count: 2, of: 3 },
      },
      schemaValid: {
        beforeRepair: { count: 2, of: 3 },
        afterRepair: { count: 2, of: 3 },
      },
    });
    expect(second).toMatchObject({
      valid: { beforeRepair: { count: 0, of: 3 }, afterRepair: { count: 0, of: 3 } },
      schemaValid: { beforeRepair: { count: 1, of: 3 }, afterRepair: { count: 2, of: 3 } },
      rejects: {
        firstTry: {
          noJson: 1,
          invalidJson: 0,
          severalObjects: 0,
          schemaErrors: 1,
          lintErrors: 1,
        },
        afterRepair: { noJson: 1, schemaErrors: 0, lintErrors: 2 },
      },
    });
    expect(report.overall).toMatchObject({
      requested: 6,
      answered: 6,
      truncated: 1,
      valid: { beforeRepair: { count: 1, of: 6 }, afterRepair: { count: 2, of: 6 } },
    });
    expect(report.overall.valid.afterRepair?.share).toBeCloseTo(2 / 6);
    expect(report.overall.valid.afterRepair?.low).toBeLessThan(2 / 6);
    expect(report.overall.valid.afterRepair?.high).toBeGreaterThan(2 / 6);
    expect(report.responseFormat).toBe("notSent");
    expect(report.stopped).toBeNull();
  });

  test("a request that failed is counted apart and left out of the rates", () => {
    const report = evaluationReport({
      runs: [run(1, [outcome(null), outcome(R.requestFailed)], 4)],
      responseFormat: "accepted",
      stopped: "omlx stayed busy",
    });
    expect(report.vibes[0]).toMatchObject({
      requested: 4,
      made: 2,
      answered: 1,
      requestFailed: 1,
      valid: { beforeRepair: { count: 1, of: 1 } },
    });
    expect(report.stopped).toBe("omlx stayed busy");
  });

  test("a vibe with no answered candidate has no rates rather than a made-up one", () => {
    const report = evaluationReport({
      runs: [run(1, [outcome(R.requestFailed)])],
      responseFormat: "noAnswer",
      stopped: "can't reach omlx",
    });
    expect(report.vibes[0]?.valid).toEqual({ beforeRepair: null, afterRepair: null });
  });

  test("latency and first-token percentiles, first tries apart from repairs, failures left out", () => {
    const report = evaluationReport({
      runs: [
        {
          ...run(1, [outcome(null)]),
          timings: [
            timing(1000),
            timing(3000),
            timing(2000),
            timing(9000, 1),
            { repairRound: 0, latencyMs: 50, firstTokenMs: null, failed: true },
          ],
        },
      ],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.latencyMs).toEqual({
      firstTry: { count: 3, p50: 2000, p90: 3000, p95: 3000, max: 3000 },
      repair: { count: 1, p50: 9000, p90: 9000, p95: 9000, max: 9000 },
    });
    expect(report.firstTokenMs.firstTry).toMatchObject({ count: 3, p50: 200 });
  });

  test("counts the answers that came back with reasoning text, failures left out", () => {
    const report = evaluationReport({
      runs: [
        {
          ...run(1, [outcome(null)]),
          timings: [
            timing(1000),
            { ...timing(2000), reasoned: false },
            { ...timing(3000, 1), reasoned: false },
            { repairRound: 0, latencyMs: 50, firstTokenMs: null, failed: true, reasoned: false },
          ],
        },
      ],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.reasoning).toEqual({ answered: 3, withReasoning: 1 });
  });

  test("with no repairs there are no repair percentiles", () => {
    const report = evaluationReport({
      runs: [run(1, [outcome(null)])],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.latencyMs.repair).toBeNull();
  });
});

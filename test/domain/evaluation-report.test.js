import { describe, expect, test } from "vitest";
import {
  evaluationReport,
  REVISION_TEST,
  REVISION_VERDICT,
} from "../../src/domain/evaluation-report.js";
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
  ranges: {},
  outcomes,
  timings: outcomes.map((_, i) => timing(1000 * (i + 1))),
  revision: null,
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
            { repairRound: 0, latencyMs: 50, firstTokenMs: null, failed: true, reasoned: false },
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

  test("without revision mode there is no revision tally", () => {
    const report = evaluationReport({
      runs: [run(1, [outcome(null)])],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.vibes[0]?.revision).toBeNull();
    expect(report.overall.revision).toBeNull();
    expect(report.revisionTiming).toBeNull();
  });
});

// Revision mode (decision 0040). A first try inside every range has no arms; one that missed
// has a treatment and a control.
/** @param {boolean} inside @param {Partial<{ unchanged: boolean, overBudget: boolean, rejected: boolean }>} [rest] */
const arm = (inside, rest = {}) => ({
  inside,
  unchanged: false,
  overBudget: false,
  rejected: false,
  ...rest,
});
const fits = () => ({ inside: true, treatment: null, control: null });
/** @param {boolean} treatment @param {boolean} control */
const pair = (treatment, control) => ({
  inside: false,
  treatment: arm(treatment),
  control: arm(control),
});
/** @param {number} n @param {() => any} make */
const times = (n, make) => Array.from({ length: n }, make);

/**
 * A revision-mode run of one vibe over `firstTries`.
 * @param {number} vibeId
 * @param {any[]} firstTries
 */
const revisionRun = (vibeId, firstTries) => ({
  ...run(
    vibeId,
    firstTries.map(() => outcome(null)),
  ),
  ranges: { lowEndShare: /** @type {[null, number]} */ ([null, 0.5]) },
  revision: { firstTries, timings: { treatment: [timing(4000)], control: [timing(2000)] } },
});

describe("evaluationReport in revision mode", () => {
  test("20 pairs with 9 fixed by the treatment alone and 1 by the control alone pass at p = 11/1024", () => {
    const firstTries = [
      ...times(4, fits),
      ...times(5, () => pair(true, true)),
      ...times(9, () => pair(true, false)),
      pair(false, true),
      ...times(5, () => pair(false, false)),
    ];
    const report = evaluationReport({
      runs: [revisionRun(1, firstTries)],
      responseFormat: "notSent",
      stopped: null,
    });
    const revision = report.overall.revision;
    expect(revision).toMatchObject({
      measured: 24,
      revised: 20,
      firstTries: { count: 4, of: 24 },
      afterTreatment: { count: 14, of: 20 },
      afterControl: { count: 6, of: 20 },
      firstTriesAfterTreatment: { count: 18, of: 24 },
      pairs: { both: 5, treatmentOnly: 9, controlOnly: 1, neither: 5 },
      verdict: REVISION_VERDICT.passes,
      unchanged: { treatment: 0, control: 0 },
    });
    expect(revision?.p).toBeCloseTo(11 / 1024, 15);
    expect(revision?.afterTreatment?.low).toBeLessThan(14 / 20);
    expect(report.vibes[0]?.revision).toEqual(revision);
    expect(report.vibes[0]?.ranges).toEqual({ lowEndShare: [null, 0.5] });
    expect(report.revisionTiming?.latencyMs.treatment).toMatchObject({ count: 1, p50: 4000 });
    expect(report.revisionTiming?.firstTokenMs.control).toMatchObject({ count: 1, p50: 200 });
  });

  test(`below ${REVISION_TEST.minimumPairs} revised first tries the test is inconclusive and gives no p`, () => {
    const report = evaluationReport({
      runs: [
        revisionRun(
          1,
          times(10, () => pair(true, false)),
        ),
      ],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.overall.revision).toMatchObject({
      revised: 10,
      pairs: { treatmentOnly: 10, controlOnly: 0 },
      p: null,
      verdict: REVISION_VERDICT.inconclusive,
    });
  });

  test("per vibe each reads its own pairs, and overall pools them for the test", () => {
    const half = [
      ...times(9, () => pair(true, false)),
      pair(false, true),
      pair(true, true),
      fits(),
    ];
    const report = evaluationReport({
      runs: [revisionRun(1, half), revisionRun(2, half)],
      responseFormat: "notSent",
      stopped: null,
    });
    for (const vibe of report.vibes) {
      expect(vibe.revision).toMatchObject({ revised: 11, verdict: REVISION_VERDICT.inconclusive });
    }
    expect(report.overall.revision).toMatchObject({
      revised: 22,
      pairs: { treatmentOnly: 18, controlOnly: 2, both: 2, neither: 0 },
      verdict: REVISION_VERDICT.passes,
    });
    expect(report.overall.revision?.p).toBeCloseTo(211 / 2 ** 20, 15);
  });

  test("a treatment that fixes some but doesn't beat the control says the gain is from asking again", () => {
    const firstTries = [
      ...times(6, () => pair(true, false)),
      ...times(6, () => pair(false, true)),
      ...times(8, () => pair(false, false)),
    ];
    const report = evaluationReport({
      runs: [revisionRun(1, firstTries)],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.overall.revision?.verdict).toBe(REVISION_VERDICT.askingAgain);
    const none = evaluationReport({
      runs: [
        revisionRun(
          1,
          times(20, () => pair(false, false)),
        ),
      ],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(none.overall.revision?.verdict).toBe(REVISION_VERDICT.fails);
  });

  test("counts each arm's unchanged, over-budget and rejected revisions", () => {
    const firstTries = [
      { inside: false, treatment: arm(false, { unchanged: true }), control: arm(true) },
      {
        inside: false,
        treatment: arm(false, { unchanged: true, overBudget: true }),
        control: arm(false, { unchanged: true }),
      },
      { inside: false, treatment: arm(false, { rejected: true }), control: arm(false) },
    ];
    const report = evaluationReport({
      runs: [revisionRun(1, firstTries)],
      responseFormat: "notSent",
      stopped: null,
    });
    expect(report.overall.revision).toMatchObject({
      unchanged: { treatment: 2, control: 1 },
      overBudget: { treatment: 1, control: 0 },
      rejected: { treatment: 1, control: 0 },
    });
  });

  test("a vibe the run never measured has no revision rates", () => {
    const report = evaluationReport({
      runs: [revisionRun(1, [])],
      responseFormat: "notSent",
      stopped: "cancelled",
    });
    expect(report.overall.revision).toMatchObject({
      measured: 0,
      revised: 0,
      firstTries: null,
      afterTreatment: null,
      p: null,
      verdict: REVISION_VERDICT.inconclusive,
    });
  });
});

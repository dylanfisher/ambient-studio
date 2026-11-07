// The evaluation's report (decision 0030): how many generated genomes pass the schema and the
// vibe's linter ("valid") and the schema alone, before and after the repair round, per vibe and
// overall, each with a 95% Wilson interval; reject reasons by type, truncation apart; and
// latency and time-to-first-token percentiles. In revision mode (decision 0040), also how often
// first tries and their two revisions land inside every range, and the paired test of the
// treatment against the control.
/** @import { Percentiles } from "./percentiles.js" */
/** @import { RejectReason } from "./reject-reason.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
import { exactMcNemar } from "./exact-mcnemar.js";
import { percentiles } from "./percentiles.js";
import { REJECT_REASON } from "./reject-reason.js";
import { wilsonInterval } from "./wilson-interval.js";

/**
 * One candidate: the reason its first answer was rejected and the reason it ended with, each
 * null when valid. They differ only for a candidate that went to the repair round.
 * @typedef {{ firstReason: RejectReason | null, finalReason: RejectReason | null }} Outcome
 */

/**
 * One generation's timing. `failed` is a request that failed in the queue, which has no answer
 * to time.
 * @typedef {object} Timing
 * @property {number} repairRound
 * @property {number} latencyMs
 * @property {number | null} firstTokenMs
 * @property {boolean} failed
 * @property {boolean} reasoned whether reasoning text came back beside the answer
 */

/**
 * One revision of a first try that missed. `inside` is false for an unchanged, over-budget or
 * rejected revision, which has no new excerpt.
 * @typedef {object} ArmOutcome
 * @property {boolean} inside its excerpt misses no range and fails no render check
 * @property {boolean} unchanged it came back as the first try's genome, or was never sent
 * @property {boolean} overBudget it was never sent, its follow-up being over the context budget
 * @property {boolean} rejected it failed the schema or the linter after its repair, or its
 *   request failed
 */

/**
 * A valid first try whose excerpt was measured: inside every range, with no revision, or
 * outside, with both arms' revisions done.
 * @typedef {{ inside: true, treatment: null, control: null }
 *   | { inside: false, treatment: ArmOutcome, control: ArmOutcome }} FirstTryOutcome
 */

/** @typedef {{ treatment: Timing[], control: Timing[] }} ArmTimings */

/**
 * What one vibe's request group made.
 * @typedef {object} VibeRun
 * @property {number} vibeId
 * @property {number} revisionId
 * @property {string} name
 * @property {string} requestGroup
 * @property {FeatureRanges} ranges the revision's feature ranges, as the run used them
 * @property {number} requested
 * @property {Outcome[]} outcomes one per candidate made, in order
 * @property {Timing[]} timings one per generation
 * @property {{ firstTries: FirstTryOutcome[], timings: ArmTimings } | null} revision in
 *   revision mode, each measured first try and each arm's generations; null otherwise
 */

/**
 * Whether omlx took the JSON-schema `response_format`: `notSent` when the config leaves it off,
 * `refused` when omlx answered 400 naming it, `accepted` when a request carrying it was
 * answered, and `noAnswer` when it was sent and no request was answered either way.
 */
export const RESPONSE_FORMAT_RESULT = Object.freeze({
  accepted: "accepted",
  refused: "refused",
  notSent: "notSent",
  noAnswer: "noAnswer",
});

/** @typedef {(typeof RESPONSE_FORMAT_RESULT)[keyof typeof RESPONSE_FORMAT_RESULT]} ResponseFormatResult */

/**
 * `share` is `count / of`; `low` and `high` its 95% Wilson interval.
 * @typedef {{ count: number, of: number, share: number, low: number, high: number }} Rate
 */

/** @typedef {{ beforeRepair: Rate | null, afterRepair: Rate | null }} RatePair */

/**
 * The paired test's rule (decision 0040): below `minimumPairs` revised first tries it gives no
 * p; at or above, the treatment beats the control when p is below `alpha`.
 */
export const REVISION_TEST = Object.freeze({ minimumPairs: 20, alpha: 0.05 });

/**
 * What the paired test says: `passes` when the treatment beats the control; `askingAgain`
 * when it doesn't but the treatment fixed at least one first try, so the gain comes from asking
 * again; `fails` when the treatment fixed none; `inconclusive` below the minimum.
 */
export const REVISION_VERDICT = Object.freeze({
  passes: "passes",
  askingAgain: "askingAgain",
  fails: "fails",
  inconclusive: "inconclusive",
});

/** @typedef {(typeof REVISION_VERDICT)[keyof typeof REVISION_VERDICT]} RevisionVerdict */

/** @typedef {{ treatment: number, control: number }} ArmCounts */

/**
 * @typedef {object} RevisionTally
 * @property {number} measured valid first tries measured, each with its revisions done
 * @property {Rate | null} firstTries of `measured`, inside every range before any revision
 * @property {number} revised first tries that missed, each revised in both arms
 * @property {Rate | null} afterTreatment of `revised`, inside after the treatment
 * @property {Rate | null} afterControl of `revised`, inside after the control
 * @property {Rate | null} firstTriesAfterTreatment of `measured`, inside before or after the
 *   treatment: the share the session would see
 * @property {{ both: number, treatmentOnly: number, controlOnly: number, neither: number }}
 *   pairs which arms landed inside
 * @property {number | null} p the exact one-sided McNemar p on treatment only against control
 *   only; null below `REVISION_TEST.minimumPairs`
 * @property {RevisionVerdict} verdict
 * @property {ArmCounts} unchanged revisions that came back unchanged, over-budget ones included
 * @property {ArmCounts} overBudget
 * @property {ArmCounts} rejected
 */

/**
 * @typedef {object} Tally
 * @property {number} requested candidates asked for
 * @property {number} made candidates stored; fewer than requested when the run stopped
 * @property {number} answered candidates whose first request was answered: every rate's
 *   denominator
 * @property {RatePair} valid schema and linter both pass
 * @property {RatePair} schemaValid the schema passes, whatever the linter says
 * @property {number} truncated answers cut off at `max_tokens`, which get no repair
 * @property {number} requestFailed candidates whose request failed in the queue
 * @property {{ firstTry: Record<string, number>, afterRepair: Record<string, number> }} rejects
 *   the model's other reject reasons, by type
 */

/** @typedef {Tally & { revision: RevisionTally | null }} RevisionModeTally */

/**
 * A vibe's tally, named as its run is.
 * @typedef {RevisionModeTally & { vibeId: number, revisionId: number, name: string,
 *   requestGroup: string, ranges: FeatureRanges }} VibeTally
 */

/**
 * @typedef {{ treatment: Percentiles | null, control: Percentiles | null }} ArmPercentiles
 */

/**
 * @typedef {object} EvaluationReport
 * @property {VibeTally[]} vibes
 * @property {RevisionModeTally} overall
 * @property {{ firstTry: Percentiles | null, repair: Percentiles | null }} latencyMs
 * @property {{ firstTry: Percentiles | null, repair: Percentiles | null }} firstTokenMs
 * @property {ResponseFormatResult} responseFormat
 * @property {{ answered: number, withReasoning: number }} reasoning of the answered generations,
 *   how many came back with reasoning text: with `queue.thinking` off, any at all says omlx or
 *   the model's chat template ignored the switch
 * @property {{ latencyMs: ArmPercentiles, firstTokenMs: ArmPercentiles } | null} revisionTiming
 *   each arm's round-0 requests, in revision mode; null otherwise
 * @property {string | null} stopped why the run stopped before it made every candidate
 */

/** The reasons counted by type; truncation and failed requests are counted on their own. */
const COUNTED = Object.freeze(
  Object.values(REJECT_REASON).filter(
    (reason) => reason !== REJECT_REASON.truncated && reason !== REJECT_REASON.requestFailed,
  ),
);

/** @param {RejectReason | null} reason */
const passesSchema = (reason) => reason === null || reason === REJECT_REASON.lintErrors;

/**
 * @param {number} count
 * @param {number} of
 * @returns {Rate | null} null when nothing was answered: no share exists to report
 */
function rate(count, of) {
  if (of === 0) return null;
  return { count, of, share: count / of, ...wilsonInterval(count, of) };
}

/**
 * @param {readonly Outcome[]} outcomes
 * @param {(outcome: Outcome) => RejectReason | null} reasonOf
 */
function countReasons(outcomes, reasonOf) {
  return Object.fromEntries(
    COUNTED.map((reason) => [reason, outcomes.filter((o) => reasonOf(o) === reason).length]),
  );
}

/**
 * @param {number} requested
 * @param {readonly Outcome[]} outcomes
 * @returns {Tally}
 */
function tally(requested, outcomes) {
  const answered = outcomes.filter((o) => o.firstReason !== REJECT_REASON.requestFailed);
  const of = answered.length;
  /** @param {(o: Outcome) => boolean} test */
  const count = (test) => answered.filter(test).length;
  return {
    requested,
    made: outcomes.length,
    answered: of,
    valid: {
      beforeRepair: rate(
        count((o) => o.firstReason === null),
        of,
      ),
      afterRepair: rate(
        count((o) => o.finalReason === null),
        of,
      ),
    },
    schemaValid: {
      beforeRepair: rate(
        count((o) => passesSchema(o.firstReason)),
        of,
      ),
      afterRepair: rate(
        count((o) => passesSchema(o.finalReason)),
        of,
      ),
    },
    truncated: count((o) => o.finalReason === REJECT_REASON.truncated),
    requestFailed: outcomes.filter((o) => o.finalReason === REJECT_REASON.requestFailed).length,
    rejects: {
      firstTry: countReasons(answered, (o) => o.firstReason),
      afterRepair: countReasons(answered, (o) => o.finalReason),
    },
  };
}

/**
 * @param {readonly Timing[]} timings
 * @param {(timing: Timing) => number | null} read
 */
function timingPercentiles(timings, read) {
  /** @param {boolean} repair */
  const of = (repair) => {
    const values = timings
      .filter((t) => !t.failed && t.repairRound > 0 === repair)
      .map(read)
      .filter((value) => value !== null);
    return values.length === 0 ? null : percentiles(values);
  };
  return { firstTry: of(false), repair: of(true) };
}

/**
 * @param {readonly FirstTryOutcome[]} firstTries
 * @returns {RevisionTally}
 */
function revisionTally(firstTries) {
  const pairs = firstTries.flatMap((f) => (f.inside ? [] : [f]));
  /** @param {(pair: { treatment: ArmOutcome, control: ArmOutcome }) => boolean} test */
  const count = (test) => pairs.filter(test).length;
  /** @param {(arm: ArmOutcome) => boolean} test */
  const arms = (test) => ({
    treatment: count((pair) => test(pair.treatment)),
    control: count((pair) => test(pair.control)),
  });
  const counts = {
    both: count((pair) => pair.treatment.inside && pair.control.inside),
    treatmentOnly: count((pair) => pair.treatment.inside && !pair.control.inside),
    controlOnly: count((pair) => !pair.treatment.inside && pair.control.inside),
    neither: count((pair) => !pair.treatment.inside && !pair.control.inside),
  };
  const revised = pairs.length;
  const fitted = firstTries.length - revised;
  const fixed = counts.both + counts.treatmentOnly;
  const p =
    revised < REVISION_TEST.minimumPairs
      ? null
      : exactMcNemar(counts.treatmentOnly, counts.controlOnly);
  /** @type {RevisionVerdict} */
  let verdict = REVISION_VERDICT.inconclusive;
  if (p !== null && p < REVISION_TEST.alpha) verdict = REVISION_VERDICT.passes;
  else if (p !== null) verdict = fixed > 0 ? REVISION_VERDICT.askingAgain : REVISION_VERDICT.fails;
  return {
    measured: firstTries.length,
    firstTries: rate(fitted, firstTries.length),
    revised,
    afterTreatment: rate(fixed, revised),
    afterControl: rate(counts.both + counts.controlOnly, revised),
    firstTriesAfterTreatment: rate(fitted + fixed, firstTries.length),
    pairs: counts,
    p,
    verdict,
    unchanged: arms((arm) => arm.unchanged),
    overBudget: arms((arm) => arm.overBudget),
    rejected: arms((arm) => arm.rejected),
  };
}

/**
 * @param {readonly VibeRun[]} runs
 * @returns {EvaluationReport["revisionTiming"]}
 */
function revisionTiming(runs) {
  const revised = runs.flatMap((r) => (r.revision === null ? [] : [r.revision.timings]));
  if (revised.length === 0) return null;
  /** @param {(timing: Timing) => number | null} read */
  const arms = (read) => ({
    treatment: timingPercentiles(
      revised.flatMap((t) => t.treatment),
      read,
    ).firstTry,
    control: timingPercentiles(
      revised.flatMap((t) => t.control),
      read,
    ).firstTry,
  });
  return { latencyMs: arms((t) => t.latencyMs), firstTokenMs: arms((t) => t.firstTokenMs) };
}

/**
 * @param {{ runs: readonly VibeRun[], responseFormat: ResponseFormatResult, stopped: string | null }} run
 * @returns {EvaluationReport}
 */
export function evaluationReport({ runs, responseFormat, stopped }) {
  const timings = runs.flatMap((r) => r.timings);
  const answered = timings.filter((t) => !t.failed);
  return {
    vibes: runs.map(({ outcomes, timings: _, revision, ...vibe }) => ({
      ...vibe,
      ...tally(vibe.requested, outcomes),
      revision: revision === null ? null : revisionTally(revision.firstTries),
    })),
    overall: {
      ...tally(
        runs.reduce((sum, r) => sum + r.requested, 0),
        runs.flatMap((r) => r.outcomes),
      ),
      revision: runs.some((r) => r.revision !== null)
        ? revisionTally(runs.flatMap((r) => r.revision?.firstTries ?? []))
        : null,
    },
    latencyMs: timingPercentiles(timings, (t) => t.latencyMs),
    firstTokenMs: timingPercentiles(timings, (t) => t.firstTokenMs),
    responseFormat,
    reasoning: {
      answered: answered.length,
      withReasoning: answered.filter((t) => t.reasoned).length,
    },
    revisionTiming: revisionTiming(runs),
    stopped,
  };
}

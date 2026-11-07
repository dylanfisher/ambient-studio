// The evaluation's report (decision 0030): how many generated genomes pass the schema and the
// vibe's linter ("valid") and the schema alone, before and after the repair round, per vibe and
// overall, each with a 95% Wilson interval; reject reasons by type, truncation apart; and
// latency and time-to-first-token percentiles.
/** @import { Percentiles } from "./percentiles.js" */
/** @import { RejectReason } from "./reject-reason.js" */
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
 */

/**
 * What one vibe's request group made.
 * @typedef {object} VibeRun
 * @property {number} vibeId
 * @property {number} revisionId
 * @property {string} name
 * @property {string} requestGroup
 * @property {number} requested
 * @property {Outcome[]} outcomes one per candidate made, in order
 * @property {Timing[]} timings one per generation
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

/** @typedef {Tally & Omit<VibeRun, "outcomes" | "timings">} VibeTally */

/**
 * @typedef {object} EvaluationReport
 * @property {VibeTally[]} vibes
 * @property {Tally} overall
 * @property {{ firstTry: Percentiles | null, repair: Percentiles | null }} latencyMs
 * @property {{ firstTry: Percentiles | null, repair: Percentiles | null }} firstTokenMs
 * @property {ResponseFormatResult} responseFormat
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
 * @param {{ runs: readonly VibeRun[], responseFormat: ResponseFormatResult, stopped: string | null }} run
 * @returns {EvaluationReport}
 */
export function evaluationReport({ runs, responseFormat, stopped }) {
  const timings = runs.flatMap((r) => r.timings);
  return {
    vibes: runs.map(({ outcomes, timings: _, ...vibe }) => ({
      ...vibe,
      ...tally(vibe.requested, outcomes),
    })),
    overall: tally(
      runs.reduce((sum, r) => sum + r.requested, 0),
      runs.flatMap((r) => r.outcomes),
    ),
    latencyMs: timingPercentiles(timings, (t) => t.latencyMs),
    firstTokenMs: timingPercentiles(timings, (t) => t.firstTokenMs),
    responseFormat,
    stopped,
  };
}

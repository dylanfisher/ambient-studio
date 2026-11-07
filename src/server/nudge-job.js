// The nudge job (decision 0037): children of a base candidate drawn in the vector view with no
// model request, every draw stored as a candidate, and each child's excerpt rendered as it is
// stored. It runs only when the owner's request adds it to the job runner.
/** @import { Finding } from "../domain/lint-result.js" */
/** @import { NudgeDraw, StepSize } from "../domain/nudge.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { CandidateRender } from "./candidate-job.js" */
/** @import { Verdict } from "./generate-candidates.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { App } from "./routing.js" */
import { nudge } from "../domain/nudge.js";
import { OPERATOR } from "../domain/operator.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { jobRecordings, STREAM_SEEDS } from "./candidate-job.js";
import { currentRevision, keep } from "./generate-candidates.js";
import { JOB_STEP } from "./job-steps.js";
import { locksInForce } from "./lock-store.js";
import { renderExcerpt } from "./render-excerpt.js";

/** The operator a nudge child stores, and the source its row gives. */
export const NUDGE_OPERATOR = OPERATOR.nudge;
const SOURCE = "mutation";

/**
 * @typedef {object} NudgeRequest
 * @property {number} vibeId
 * @property {number} sessionId the session the children are made in, which may be a later one
 *   than the base's
 * @property {Candidate} base
 * @property {Genome} genome the base's
 * @property {StepSize} stepSize
 * @property {number} count
 */

/**
 * @typedef {object} NudgeJobResult
 * @property {number} seed the nudge seed, drawn when the job starts
 * @property {number[]} candidateIds every draw stored, rejected ones included, in order
 * @property {CandidateRender[]} excerpts one per child made
 * @property {FailedChild[]} failedChildren the children whose every draw was rejected
 */

/**
 * A child given up, numbered from 1, with its last draw's findings, which say why: a base that
 * breaks a value the vibe fixes fails every draw on it, since nudges hold fixed values.
 * @typedef {{ child: number, findings: Finding[] }} FailedChild
 */

/**
 * A draw as the verdict `keep` stores.
 * @param {NudgeDraw} draw
 * @returns {Verdict}
 */
const verdictOf = ({ reason, lint, genome, written, lockChanges }) => ({
  reason,
  lint,
  intent: null,
  genome,
  answer: null,
  written,
  lockChanges,
});

/**
 * The job that nudges `base` into `count` children under the vibe's current revision and live
 * locks, read when it starts. Progress counts children: one is done once its draws are stored
 * and, when one passed, its excerpt is rendered. A cancel during a render stops the job before
 * the next child, with every row before it stored.
 * @param {App} app
 * @param {NudgeRequest} request
 * @returns {(job: JobContext) => Promise<NudgeJobResult>}
 */
export function nudgeJob(app, { vibeId, sessionId, base, genome, stepSize, count }) {
  return async (job) => {
    const recordings = await jobRecordings(app);
    job.signal.throwIfAborted();
    const { revision, constraints } = currentRevision(app.store, vibeId);
    const locks = locksInForce(app.store, vibeId);
    const seed = Math.floor(app.random() * STREAM_SEEDS);
    const children = nudge({
      base: genome,
      baseId: base.id,
      locks,
      constraints,
      stepSize,
      seed,
      count,
    });
    const batch = { store: app.store, vibeId, vibeRevisionId: revision.id, sessionId, locks };
    // A child keeps the base's seed, so it differs from the base only in its genome.
    const origin = {
      seed: base.seed,
      source: SOURCE,
      parentIds: [base.id],
      operator: NUDGE_OPERATOR,
      operatorParams: { stepSize, seed },
    };
    /** @type {number[]} */
    const candidateIds = [];
    /** @type {CandidateRender[]} */
    const excerpts = [];
    /** @type {FailedChild[]} */
    const failedChildren = [];
    for (const [index, draws] of children.entries()) {
      /** @type {Candidate | null} */
      let child = null;
      for (const draw of draws) {
        const candidate = keep(batch, null, verdictOf(draw), origin);
        candidateIds.push(candidate.id);
        if (draw.genome) child = candidate;
      }
      if (child === null) {
        const last = /** @type {NudgeDraw} */ (draws.at(-1));
        failedChildren.push({ child: index + 1, findings: last.lint.findings });
      } else {
        // A child that passed has a genome row, so it has an excerpt to render.
        const request = /** @type {ExcerptRequest} */ (excerptRequest(app.store, child));
        job.progress(index, count, JOB_STEP.renderingNudge(index + 1, count));
        job.signal.throwIfAborted();
        const { render } = await renderExcerpt(
          app.store,
          app.paths.renderCache,
          request,
          recordings,
        );
        excerpts.push({ candidateId: child.id, renderId: render.id });
      }
      job.progress(index + 1, count, null);
      job.signal.throwIfAborted();
    }
    return { seed, candidateIds, excerpts, failedChildren };
  };
}

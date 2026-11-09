// The retune job (decision 0094): one child of a base candidate with the owner's tuning, scale
// and key, stored as a candidate and its excerpt rendered, with no model request. It runs only
// when the owner's request adds it to the job runner.
/** @import { Finding } from "../domain/lint-result.js" */
/** @import { RetunePitch } from "../domain/retune.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { CandidateRender } from "./candidate-job.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { App } from "./routing.js" */
import { OPERATOR } from "../domain/operator.js";
import { retune } from "../domain/retune.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { jobRecordings } from "./candidate-job.js";
import { currentRevision, keep, verdictOf } from "./generate-candidates.js";
import { JOB_STEP } from "./job-steps.js";
import { locksInForce } from "./lock-store.js";
import { NUDGE_SOURCE } from "./nudge-job.js";
import { renderExcerpt } from "./render-excerpt.js";

/** The operator a retune child stores. Its source is a nudge's: a change made by code. */
export const RETUNE_OPERATOR = OPERATOR.retune;

/**
 * @typedef {object} RetuneRequest
 * @property {number} vibeId
 * @property {number} sessionId the session the child is made in
 * @property {Candidate} base
 * @property {Genome} genome the base's
 * @property {RetunePitch} pitch
 */

/**
 * @typedef {object} RetuneJobResult
 * @property {number} candidateId the child, stored rejected when the brief or locks changed
 *   after the request and refuse it now
 * @property {CandidateRender | null} excerpt null when the child was rejected
 * @property {Finding[]} findings why it was rejected; empty when it passed
 */

/**
 * The job that retunes `base` under the vibe's current revision and live locks, read when it
 * starts. Progress is one step: the child's excerpt.
 * @param {App} app
 * @param {RetuneRequest} request
 * @returns {(job: JobContext) => Promise<RetuneJobResult>}
 */
export function retuneJob(app, { vibeId, sessionId, base, genome, pitch }) {
  return async (job) => {
    const recordings = await jobRecordings(app);
    job.signal.throwIfAborted();
    const { revision, constraints } = currentRevision(app.store, vibeId);
    const locks = locksInForce(app.store, vibeId);
    const made = retune({ base: genome, pitch, locks, constraints });
    const batch = { store: app.store, vibeId, vibeRevisionId: revision.id, sessionId, locks };
    // The child keeps the base's seed, so it differs from the base only in its pitch.
    const child = keep(batch, null, verdictOf(made), {
      seed: base.seed,
      source: NUDGE_SOURCE,
      parentIds: [base.id],
      operator: RETUNE_OPERATOR,
      operatorParams: { ...pitch },
    });
    if (made.genome === null) {
      return { candidateId: child.id, excerpt: null, findings: made.lint.findings };
    }
    job.progress(0, 1, JOB_STEP.renderingRetune);
    // A child that passed has a genome row, so it has an excerpt to render.
    const request = /** @type {ExcerptRequest} */ (excerptRequest(app.store, child));
    const { render } = await renderExcerpt(app.store, app.paths.renderCache, request, recordings);
    job.progress(1, 1, null);
    return {
      candidateId: child.id,
      excerpt: { candidateId: child.id, renderId: render.id },
      findings: [],
    };
  };
}

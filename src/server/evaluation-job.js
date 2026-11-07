// The evaluation job (decision 0030): asks omlx for `count` candidates for each vibe through 2f's
// generation, with one stream seed for every vibe, and stores the report in `evaluations`. It
// runs only when the owner's request adds it to the job runner, which runs one job at a time, so
// it shares the one omlx queue with nothing else.
/** @import { ResponseFormatResult, VibeRun } from "../domain/evaluation-report.js" */
/** @import { RejectReason } from "../domain/reject-reason.js" */
/** @import { Generation } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { evaluationReport, RESPONSE_FORMAT_RESULT } from "../domain/evaluation-report.js";
import { jobRecordings, STREAM_SEEDS } from "./candidate-job.js";
import { addEvaluation } from "./evaluation-store.js";
import { generateCandidates, requestGroupName } from "./generate-candidates.js";
import { listRequestGroup } from "./generation-store.js";
import { OmlxRequestError, RESPONSE_FORMAT_REFUSED } from "./omlx-queue.js";
import { getVibe } from "./vibe-store.js";

/**
 * What the owner started the evaluation with, and the settings that shape its numbers.
 * @typedef {object} EvaluationParams
 * @property {number[]} vibeIds in the order they ran
 * @property {number} count candidates asked for per vibe
 * @property {number} seed the stream seed every vibe's request group uses
 * @property {string} model
 * @property {boolean} sendResponseFormat
 * @property {number} maxTokens
 */

/**
 * @param {boolean} sent whether the config sends `response_format`
 * @param {readonly Generation[]} generations
 * @returns {ResponseFormatResult}
 */
function responseFormatResult(sent, generations) {
  if (!sent) return RESPONSE_FORMAT_RESULT.notSent;
  if (generations.some((g) => g.error?.startsWith(RESPONSE_FORMAT_REFUSED))) {
    return RESPONSE_FORMAT_RESULT.refused;
  }
  return generations.some((g) => g.error === null)
    ? RESPONSE_FORMAT_RESULT.accepted
    : RESPONSE_FORMAT_RESULT.noAnswer;
}

/**
 * The job that evaluates generation over `vibeIds`. A request that fails in the queue (busy past
 * the wait, a timeout, a refused `response_format`, a cancel) stops the run: the report of what
 * was made is stored, saying why it stopped, and the job then fails with the error. Cancelling
 * the job cancels the omlx queue, which is the job's alone while it runs.
 * @param {App} app
 * @param {{ vibeIds: number[], count: number }} request
 * @returns {(job: JobContext) => Promise<{ evaluationId: number }>}
 */
export function evaluationJob(app, { vibeIds, count }) {
  return async (job) => {
    const { config, store } = app;
    const recordings = await jobRecordings(app);
    /** @type {EvaluationParams} */
    const params = {
      vibeIds,
      count,
      seed: Math.floor(app.random() * STREAM_SEEDS),
      model: config.omlx.model,
      sendResponseFormat: config.queue.sendResponseFormat,
      maxTokens: config.queue.maxTokens,
    };
    /** @type {VibeRun[]} */
    const runs = [];
    /** @type {OmlxRequestError | null} */
    let failure = null;
    const total = vibeIds.length * count;
    let done = 0;
    job.progress(done, total);
    // Every vibe has a run from the start, so a run that stops early still reports the vibes it
    // never reached, with nothing made.
    for (const vibeId of vibeIds) {
      const vibe = getVibe(store, vibeId);
      if (!vibe) throw new Error(`there is no vibe ${vibeId}`);
      runs.push({
        vibeId,
        revisionId: vibe.revision.id,
        name: vibe.revision.name,
        requestGroup: requestGroupName(vibeId, params.seed),
        requested: count,
        outcomes: [],
        timings: [],
      });
    }
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      for (const { vibeId, outcomes } of runs) {
        try {
          await generateCandidates(vibeId, count, store, app.queue, {
            config,
            seed: params.seed,
            sessionId: null,
            locks: [],
            recordings,
            onCandidate: (candidate, firstReason) => {
              outcomes.push({
                firstReason,
                finalReason: /** @type {RejectReason | null} */ (candidate.rejectReason),
              });
              job.progress(++done, total);
            },
          });
        } catch (error) {
          if (!(error instanceof OmlxRequestError)) throw error;
          failure = error;
          break;
        }
      }
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
    // Timed from the stored generations, so a repair and a failed request count as stored.
    /** @type {Generation[]} */
    const generations = [];
    for (const run of runs) {
      const group = listRequestGroup(store, run.requestGroup);
      generations.push(...group);
      run.timings = group.map((g) => ({
        repairRound: g.repairRound,
        latencyMs: g.latencyMs,
        firstTokenMs: g.firstTokenMs,
        failed: g.error !== null,
      }));
    }
    const report = evaluationReport({
      runs,
      responseFormat: responseFormatResult(params.sendResponseFormat, generations),
      stopped: failure?.message ?? null,
    });
    const evaluation = addEvaluation(store, { params, report });
    if (failure) throw failure;
    return { evaluationId: evaluation.id };
  };
}

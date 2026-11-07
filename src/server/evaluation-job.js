// The evaluation job (decision 0030): asks omlx for `count` candidates for each vibe through 2f's
// generation, with one stream seed for every vibe, and stores the report in `evaluations`. In
// revision mode (0040) it also renders each valid first try and revises one that misses twice,
// the treatment and the control, and renders both. It runs only when the owner's request adds it
// to the job runner, which runs one job at a time, so it shares the one omlx queue with nothing
// else.
/** @import { ArmOutcome, ResponseFormatResult, Timing, VibeRun } from "../domain/evaluation-report.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { Finding, LintResult } from "../domain/lint-result.js" */
/** @import { RejectReason } from "../domain/reject-reason.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
/** @import { Candidate, Generation } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { App } from "./routing.js" */
/** @import { VibeRevision } from "./vibe-store.js" */
import { evaluationReport, RESPONSE_FORMAT_RESULT } from "../domain/evaluation-report.js";
import { excerptMisses } from "../domain/excerpt-misses.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { generationStepText, jobRecordings, STREAM_SEEDS } from "./candidate-job.js";
import { addEvaluation } from "./evaluation-store.js";
import {
  checkRevision,
  controlGroupName,
  controlSeed,
  generateCandidates,
  playableHashes,
  requestGroupName,
  revisedGroupName,
  revisionSeed,
} from "./generate-candidates.js";
import { listRequestGroup } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { RESPONSE_FORMAT_REFUSED } from "./omlx-queue.js";
import { renderExcerpt } from "./render-excerpt.js";
import { isUnchanged, reviseCandidate } from "./revise-candidate.js";
import { getRevision, getVibe } from "./vibe-store.js";

/**
 * What the owner started the evaluation with, and the settings that shape its numbers.
 * @typedef {object} EvaluationParams
 * @property {number[]} vibeIds in the order they ran
 * @property {number} count candidates asked for per vibe
 * @property {boolean} revise revision mode: each first try that misses is revised in both arms
 * @property {number} seed the stream seed every vibe's request group uses
 * @property {string} model
 * @property {boolean} sendResponseFormat
 * @property {boolean} thinking
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

/** @param {readonly Generation[]} group */
const timingsOf = (group) =>
  group.map((g) => ({
    repairRound: g.repairRound,
    latencyMs: g.latencyMs,
    firstTokenMs: g.firstTokenMs,
    failed: g.error !== null,
    reasoned: g.reasoning !== null,
  }));

/** @typedef {"treatment" | "control"} Arm */

/**
 * What revision mode's steps for one vibe share (decision 0040). Each valid first try is
 * rendered and checked; one that misses gets both arms' revisions back to back, in the order
 * `controlFirst` gives, then each that came back changed and valid is rendered and checked.
 * @typedef {object} RevisionStep
 * @property {App} app
 * @property {JobContext} job
 * @property {readonly RecordingEntry[]} recordings
 * @property {number} seed the stream seed
 * @property {string} requestGroup the vibe's first tries'
 * @property {(step: string | null) => void} say reports progress with the step sentence
 */

/**
 * The ranges of the vibe revision a candidate was made under, which its prompt stated and a
 * revision of it shares.
 * @param {App} app
 * @param {Candidate} candidate
 * @returns {{ revision: VibeRevision, ranges: FeatureRanges }}
 */
function madeUnder(app, candidate) {
  const revision = getRevision(app.store, candidate.vibeRevisionId);
  if (!revision) throw new Error(`there is no vibe revision ${candidate.vibeRevisionId}`);
  return { revision, ranges: checkRevision(revision).ranges };
}

/**
 * Renders the candidate's excerpt and lists its misses against the ranges it was made under.
 * @param {RevisionStep} context
 * @param {Candidate} candidate
 * @param {string} step
 */
async function measure({ app, job, recordings, say }, candidate, step) {
  const request = excerptRequest(app.store, candidate);
  if (!request) throw new Error(`candidate ${candidate.id} has no genome to render`);
  say(step);
  job.signal.throwIfAborted();
  const { render } = await renderExcerpt(app.store, app.paths.renderCache, request, recordings);
  const features = /** @type {Features} */ (render.features);
  const { ranges } = madeUnder(app, candidate);
  const misses = excerptMisses(features, /** @type {LintResult} */ (render.checks), ranges);
  return { features, misses };
}

/**
 * Revises a first try that missed in both arms and measures each revision.
 * @param {RevisionStep} context
 * @param {Candidate} firstTry
 * @param {{ index: number, offset: number, total: number, controlFirst: boolean,
 *   features: Features, misses: Finding[] }} at `index` is the first try's in its vibe, from 0,
 *   and `offset` how many candidates the run asked for before the vibe's first
 * @returns {Promise<Record<Arm, ArmOutcome>>}
 */
async function reviseBoth(context, firstTry, at) {
  const { app, job, recordings, seed, requestGroup, say } = context;
  const { index, offset, total, controlFirst, features, misses } = at;
  const n = offset + index + 1;
  /** @type {Arm[]} */
  const order = controlFirst ? ["control", "treatment"] : ["treatment", "control"];
  /** @type {Partial<Record<Arm, Candidate>>} */
  const made = {};
  for (const arm of order) {
    const control = arm === "control";
    job.signal.throwIfAborted();
    made[arm] = await reviseCandidate(app.store, app.queue, firstTry, {
      config: app.config,
      sessionId: null,
      requestGroup: control ? controlGroupName(requestGroup) : revisedGroupName(requestGroup),
      index,
      seed: control ? controlSeed(seed, index) : revisionSeed(seed, index),
      locks: [],
      playable: playableHashes(recordings),
      features,
      misses,
      control,
      onStep: (step) =>
        say(
          generationStepText(
            step,
            offset,
            total,
            control ? JOB_STEP.revisingControl : JOB_STEP.revising,
          ),
        ),
    });
  }
  /** @type {Partial<Record<Arm, ArmOutcome>>} */
  const outcomes = {};
  for (const arm of order) {
    const revision = /** @type {Candidate} */ (made[arm]);
    const unchanged = isUnchanged(revision);
    const rejected = revision.rejectReason !== null;
    let inside = false;
    if (!unchanged && !rejected) {
      const step = arm === "control" ? JOB_STEP.renderingControl : JOB_STEP.renderingRevision;
      inside = (await measure(context, revision, step(n, total))).misses.length === 0;
    }
    outcomes[arm] = {
      inside,
      unchanged,
      overBudget: unchanged && revision.generationId === null,
      rejected,
    };
  }
  return /** @type {Record<Arm, ArmOutcome>} */ (outcomes);
}

/**
 * The job that evaluates generation over `vibeIds`. Any error once the vibes are read stops the
 * run: a request that fails in the queue (busy past the wait, a timeout, a refused
 * `response_format`, a cancel), a cancel between requests, or a fault in a render or a prompt.
 * The report of what was made is stored, saying why it stopped, and the job then fails with the
 * error. Cancelling the job cancels the omlx queue, which is the
 * job's alone while it runs. With `revise`, a first try is counted done once it is measured and,
 * when it missed, both its revisions are measured; a pair left unfinished is left out of the
 * report.
 * @param {App} app
 * @param {{ vibeIds: number[], count: number, revise: boolean }} request
 * @returns {(job: JobContext) => Promise<{ evaluationId: number }>}
 */
export function evaluationJob(app, { vibeIds, count, revise }) {
  return async (job) => {
    const { config, store } = app;
    const recordings = await jobRecordings(app);
    /** @type {EvaluationParams} */
    const params = {
      vibeIds,
      count,
      revise,
      seed: Math.floor(app.random() * STREAM_SEEDS),
      model: config.omlx.model,
      sendResponseFormat: config.queue.sendResponseFormat,
      thinking: config.queue.thinking,
      maxTokens: config.queue.maxTokens,
    };
    /** @type {VibeRun[]} */
    const runs = [];
    /** @type {Error | null} */
    let failure = null;
    const total = vibeIds.length * count;
    let done = 0;
    // Pairs are counted across the run, so the arms take turns going first.
    let pairs = 0;
    job.progress(done, total, null);
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
        ranges: checkRevision(vibe.revision).ranges,
        requested: count,
        outcomes: [],
        timings: [],
        revision: revise ? { firstTries: [], timings: { treatment: [], control: [] } } : null,
      });
    }
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      // A cancel while the folder was indexed fired before the listener was added.
      job.signal.throwIfAborted();
      for (const [i, run] of runs.entries()) {
        const { vibeId, outcomes, revision } = run;
        // Candidates are numbered across every vibe, as the progress bar counts them.
        const offset = i * count;
        /** @type {RevisionStep} */
        const context = {
          app,
          job,
          recordings,
          seed: params.seed,
          requestGroup: run.requestGroup,
          say: (step) => job.progress(done, total, step),
        };
        try {
          await generateCandidates(vibeId, count, store, app.queue, {
            config,
            seed: params.seed,
            sessionId: null,
            locks: [],
            recordings,
            onCandidate: async (candidate, firstReason) => {
              const index = outcomes.length;
              // The vibe's prompt read its revision when the vibe's turn came, which may be
              // newer than the one the run started with: report the one its candidates used.
              if (index === 0) {
                const { revision: used, ranges } = madeUnder(app, candidate);
                Object.assign(run, { revisionId: used.id, name: used.name, ranges });
              }
              outcomes.push({
                firstReason,
                finalReason: /** @type {RejectReason | null} */ (candidate.rejectReason),
              });
              if (revision && candidate.rejectReason === null) {
                const n = offset + index + 1;
                const step = JOB_STEP.renderingCandidate(n, total);
                const { features, misses } = await measure(context, candidate, step);
                context.say(JOB_STEP.measuring(n, total));
                if (misses.length === 0) {
                  revision.firstTries.push({ inside: true, treatment: null, control: null });
                } else {
                  const controlFirst = pairs++ % 2 === 1;
                  const arms = await reviseBoth(context, candidate, {
                    index,
                    offset,
                    total,
                    controlFirst,
                    features,
                    misses,
                  });
                  revision.firstTries.push({ inside: false, ...arms });
                }
              }
              job.progress(++done, total, null);
            },
            onStep: (step) => job.progress(done, total, generationStepText(step, offset, total)),
          });
        } catch (error) {
          // Any error stops the run with what was made stored: a failed request, a cancel
          // between requests (the signal's reason), or a fault in a render.
          failure = error instanceof Error ? error : new Error(String(error));
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
      run.timings = timingsOf(group);
      if (run.revision) {
        /** @type {Record<Arm, Timing[]>} */
        const timings = {
          treatment: timingsOf(listRequestGroup(store, revisedGroupName(run.requestGroup))),
          control: timingsOf(listRequestGroup(store, controlGroupName(run.requestGroup))),
        };
        run.revision.timings = timings;
      }
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

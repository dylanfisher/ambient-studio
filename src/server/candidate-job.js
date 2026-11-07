// The session's jobs (decisions 0027, 0031): ask omlx for candidates (0024) and render each valid
// one's excerpt as it is made (0026), or render the excerpts a session's candidates are missing.
// Each runs only when the owner's request adds it to the job runner.
/** @import { GenerationStep } from "./generate-candidates.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { App } from "./routing.js" */
import { excerptRequest } from "./candidate-excerpt.js";
import { GENERATION_STEP, generateCandidates } from "./generate-candidates.js";
import { JOB_STEP } from "./job-steps.js";
import { indexRecordings } from "./recording-index.js";
import { renderExcerpt, renderExcerpts } from "./render-excerpt.js";

/** How many candidates one request asks for when it doesn't say. */
export const DEFAULT_CANDIDATES = 8;
/** The most one request may ask for: 32 is a few minutes of omlx and of renders. */
export const MAX_CANDIDATES = 32;
/** Stream seeds are integers in [0, 2^32) (decision 0024). */
export const STREAM_SEEDS = 2 ** 32;

/**
 * @typedef {{ candidateId: number, renderId: number }} CandidateRender
 */

/** Each app's last index of its recordings folder, so a job re-reads only changed files. */
/** @type {WeakMap<App, RecordingEntry[]>} */
const lastIndex = new WeakMap();

/**
 * The recordings folder's index for one job (decision 0029), or none when the config sets no
 * folder. Read once when the job starts, so every candidate and excerpt in it sees one index.
 * @param {App} app
 * @returns {Promise<RecordingEntry[]>}
 */
export async function jobRecordings(app) {
  const folder = app.config.fieldRecordings;
  if (folder === null) return [];
  const index = await indexRecordings(folder, lastIndex.get(app) ?? []);
  lastIndex.set(app, index);
  return index;
}

/**
 * @typedef {object} CandidateJobResult
 * @property {string} requestGroup
 * @property {number[]} candidateIds every candidate made, rejected ones included, in order
 * @property {CandidateRender[]} excerpts one per valid candidate
 */

/**
 * Renders the excerpt of every candidate with a genome, reusing cached ones.
 * @param {App} app
 * @param {Candidate[]} candidates
 * @param {JobContext} job
 * @param {readonly RecordingEntry[]} recordings the job's index
 * @returns {Promise<CandidateRender[]>}
 */
async function renderFor(app, candidates, job, recordings) {
  /** @type {{ candidate: Candidate, request: ExcerptRequest }[]} */
  const wanted = [];
  for (const candidate of candidates) {
    const request = excerptRequest(app.store, candidate);
    if (request) wanted.push({ candidate, request });
  }
  const rendered = await renderExcerpts(
    app.store,
    app.paths.renderCache,
    wanted.map(({ request }) => request),
    job,
    recordings,
  );
  return rendered.map(({ render }, i) => ({
    candidateId: /** @type {{ candidate: Candidate }} */ (wanted[i]).candidate.id,
    renderId: render.id,
  }));
}

/**
 * What a generation step tells the owner, numbering candidate `index` from 1 of `total`.
 * @param {GenerationStep} step
 * @param {number} offset how many candidates came before this run's first
 * @param {number} total
 */
export function generationStepText({ index, kind }, offset, total) {
  const n = offset + index + 1;
  if (kind === GENERATION_STEP.asking) return JOB_STEP.asking(n, total);
  if (kind === GENERATION_STEP.repairing) return JOB_STEP.repairing(n);
  return JOB_STEP.busy;
}

/**
 * The job that generates `count` candidates for the session's vibe and renders each valid one's
 * excerpt as soon as it is made, before asking for the next, so the owner can hear the first
 * while the rest are made. Between requests nothing is in flight at omlx, so a render never
 * shares the event loop with a request's first-token timer. Progress counts candidates: one is
 * done once it is stored and, when valid, rendered. Cancelling the job cancels the omlx queue
 * too, which is the job's alone while it runs, since the runner runs one job at a time, and a
 * cancel during a render stops the job before its next request.
 * @param {App} app
 * @param {{ vibeId: number, sessionId: number, count: number }} request
 * @returns {(job: JobContext) => Promise<CandidateJobResult>}
 */
export function candidateJob(app, { vibeId, sessionId, count }) {
  return async (job) => {
    const recordings = await jobRecordings(app);
    /** @type {CandidateRender[]} */
    const excerpts = [];
    let done = 0;
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      // A cancel while the folder was indexed fired before the listener was added.
      job.signal.throwIfAborted();
      const { requestGroup, candidates } = await generateCandidates(
        vibeId,
        count,
        app.store,
        app.queue,
        {
          config: app.config,
          seed: Math.floor(app.random() * STREAM_SEEDS),
          sessionId,
          locks: [],
          recordings,
          onStep: (step) => job.progress(done, count, generationStepText(step, 0, count)),
          onCandidate: async (candidate) => {
            const request = excerptRequest(app.store, candidate);
            if (request) {
              job.progress(done, count, JOB_STEP.renderingCandidate(done + 1, count));
              job.signal.throwIfAborted();
              const { render } = await renderExcerpt(
                app.store,
                app.paths.renderCache,
                request,
                recordings,
              );
              excerpts.push({ candidateId: candidate.id, renderId: render.id });
            }
            job.progress(++done, count, null);
            job.signal.throwIfAborted();
          },
        },
      );
      return { requestGroup, candidateIds: candidates.map(({ id }) => id), excerpts };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

/**
 * The job that renders the excerpt of each of `candidates` that has a genome, for one whose
 * cached excerpt was replaced or made by another producer.
 * @param {App} app
 * @param {Candidate[]} candidates
 * @returns {(job: JobContext) => Promise<{ excerpts: CandidateRender[] }>}
 */
export function excerptJob(app, candidates) {
  return async (job) => ({
    excerpts: await renderFor(app, candidates, job, await jobRecordings(app)),
  });
}

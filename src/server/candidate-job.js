// The session's jobs (decision 0027): ask omlx for candidates (0024) and render each valid one's
// excerpt (0026), or render the excerpts a session's candidates are missing. Each runs only when
// the owner's request adds it to the job runner.
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { App } from "./routing.js" */
import { excerptRequest } from "./candidate-excerpt.js";
import { generateCandidates } from "./generate-candidates.js";
import { indexRecordings } from "./recording-index.js";
import { renderExcerpts } from "./render-excerpt.js";

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
 * The job that generates `count` candidates for the session's vibe and renders their excerpts.
 * Cancelling it cancels the omlx queue too, which is the job's alone while it runs, since the
 * runner runs one job at a time.
 * @param {App} app
 * @param {{ vibeId: number, sessionId: number, count: number }} request
 * @returns {(job: JobContext) => Promise<CandidateJobResult>}
 */
export function candidateJob(app, { vibeId, sessionId, count }) {
  return async (job) => {
    const recordings = await jobRecordings(app);
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    /** @type {Awaited<ReturnType<typeof generateCandidates>>} */
    let generated;
    try {
      // A cancel while the folder was indexed fired before the listener was added.
      job.signal.throwIfAborted();
      generated = await generateCandidates(vibeId, count, app.store, app.queue, {
        config: app.config,
        seed: Math.floor(app.random() * STREAM_SEEDS),
        sessionId,
        locks: [],
        recordings,
      });
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
    const { requestGroup, candidates } = generated;
    const excerpts = await renderFor(app, candidates, job, recordings);
    return { requestGroup, candidateIds: candidates.map(({ id }) => id), excerpts };
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

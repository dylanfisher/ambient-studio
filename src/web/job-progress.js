// A job's status as the pages show it (decision 0032): what it is doing in a sentence, a bar
// from its count, and how long it has run. No DOM here, so the wording is tested.
import { JOB_KIND } from "../domain/job-kind.js";
import { OPERATOR } from "../domain/operator.js";
import { isObject } from "../engine/is-object.js";

/** What each kind of job is called on the page. */
const TITLE = Object.freeze({
  candidates: "New candidates for this brief",
  excerpts: "Rendering missing excerpts",
  evaluation: "Model test",
  agreement: "Taste model test",
  nudge: "Nudging a candidate",
  explore: "The model's variations of a candidate",
  [OPERATOR.optimize]: "Searching by your taste model",
  [OPERATOR.optimizeEar]: "Searching by ear",
  [OPERATOR.steer]: "Steering by the sliders",
  [OPERATOR.elite]: "Filling the map",
  [JOB_KIND.analyze]: "Analyzing a region",
  [JOB_KIND.embed]: "Analyzing the sound",
  [JOB_KIND.fit]: "Fitting the taste model",
  [JOB_KIND.sectionAudio]: "Rendering a section to play",
});

/** A job's states, as the server's job runner names them (decision 0026). */
export const JOB_STATE = Object.freeze({
  queued: "queued",
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
});

/** Each state as a badge reads. */
const STATE = Object.freeze({
  [JOB_STATE.queued]: "Waiting",
  [JOB_STATE.running]: "Running",
  [JOB_STATE.done]: "Done",
  [JOB_STATE.failed]: "Failed",
  [JOB_STATE.cancelled]: "Cancelled",
});

/**
 * The parts of a job's status the pages read. `progress.step` is a sentence the server writes;
 * an older server sends only the count.
 * @typedef {object} JobStatus
 * @property {number} id
 * @property {string} kind
 * @property {string} state
 * @property {{ done: number, total: number, step?: string | null } | null} progress
 * @property {string | null} error
 * @property {number} addedAt
 * @property {number | null} startedAt
 * @property {number | null} finishedAt
 * @property {unknown} [result] the job's return value once done, read when `GET /api/jobs/:id`
 *   sends it
 */

/**
 * @typedef {object} JobProgress
 * @property {string} title
 * @property {string} state
 * @property {string} step
 * @property {number | null} fraction from 0 to 1, or null while there is no count
 * @property {string} elapsed
 * @property {string | null} error
 * @property {string | null} notEmbedded why a candidates job's excerpts weren't embedded
 *   (decision 0042), as a sentence; null when they were, or the job says nothing of it
 * @property {string | null} notRanked why a candidates job left the session unranked
 *   (decision 0046), as a sentence; null when it ranked it, or the job says nothing of it
 * @property {boolean} finished
 */

/** @param {number} n */
const twoDigits = (n) => String(n).padStart(2, "0");

/**
 * @param {number} ms
 * @returns {string} such as `42 s`, `1 min 05 s` or `1 h 02 min`
 */
export function durationText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${twoDigits(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${twoDigits(minutes % 60)} min`;
}

/** @param {string} text */
const sentence = (text) => {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.?!]$/.test(capital) ? capital : `${capital}.`;
};

/** @param {JobStatus} job */
function stepText({ state, progress }) {
  if (typeof progress?.step === "string" && progress.step.trim() !== "") {
    return sentence(progress.step);
  }
  if (progress) return `${progress.done} of ${progress.total} done.`;
  if (state === JOB_STATE.queued) return "Waiting for the job ahead of it to finish.";
  if (state === JOB_STATE.running) return "Started; no count yet.";
  return "No count was reported.";
}

/**
 * @param {JobStatus} job
 * @param {number} now the browser's clock; the job's times come from the server's, so a skew
 *   between machines shows in the elapsed time
 */
function elapsedText({ addedAt, startedAt, finishedAt }, now) {
  if (finishedAt !== null) return `Took ${durationText(finishedAt - (startedAt ?? addedAt))}.`;
  if (startedAt === null) return `Waiting for ${durationText(now - addedAt)}.`;
  return `Running for ${durationText(now - startedAt)}.`;
}

/**
 * The reason a candidates job returns under `key`, as a sentence, or null.
 * @param {JobStatus} job
 * @param {"notEmbedded" | "notRanked"} key
 */
function reasonText({ result }, key) {
  if (!isObject(result)) return null;
  const reason = result[key];
  return typeof reason === "string" ? sentence(reason) : null;
}

/**
 * @param {JobStatus} job
 * @param {number} now milliseconds since the epoch
 * @returns {JobProgress}
 */
export function jobProgress(job, now) {
  const title = TITLE[/** @type {keyof typeof TITLE} */ (job.kind)];
  if (title === undefined)
    throw new Error(`job ${job.id} is of a kind the page doesn't know: ${job.kind}`);
  const state = STATE[/** @type {keyof typeof STATE} */ (job.state)];
  if (state === undefined)
    throw new Error(`job ${job.id} is in a state the page doesn't know: ${job.state}`);
  const { progress } = job;
  return {
    title,
    state,
    step: stepText(job),
    fraction: progress && progress.total > 0 ? progress.done / progress.total : null,
    elapsed: elapsedText(job, now),
    error: job.error,
    notEmbedded: reasonText(job, "notEmbedded"),
    notRanked: reasonText(job, "notRanked"),
    finished: job.finishedAt !== null,
  };
}

/**
 * The status line's sentence for a followed job that ended without finishing its work.
 * @param {JobStatus} job failed or cancelled
 */
export const endedText = ({ state }) =>
  `The job ${state === JOB_STATE.failed ? "stopped on an error; its box says why" : "was cancelled"}.`;

/**
 * Why a button that starts a job is off while one runs.
 * @param {{ id: number, kind: string }} job
 */
export const waitTitle = ({ id, kind }) =>
  `Turned off while job ${id} (${(TITLE[/** @type {keyof typeof TITLE} */ (kind)] ?? kind).toLowerCase()}) runs, so the same request isn't queued twice. It turns back on when that job finishes.`;

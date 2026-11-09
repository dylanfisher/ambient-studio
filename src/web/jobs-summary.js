// What the top bar shows of the server's jobs: for each of the runner's lanes (decision 0092),
// the job running there, or the oldest waiting, with its count, and how many more wait behind it.
// No DOM here, so the wording is tested.
/** @import { JobStatus } from "./job-progress.js" */
import { JOB_LANE, jobLane } from "../domain/job-kind.js";
import { JOB_STATE, jobProgress } from "./job-progress.js";

/**
 * @typedef {object} JobsSummary
 * @property {number} id the job shown, which its Cancel cancels
 * @property {string} text what the bar reads, such as `Fitting the taste model · 40% · 2 more`
 * @property {string} title its tooltip: the job's step and how long it has run
 * @property {number | null} fraction from 0 to 1, or null while the job has no count
 */

/**
 * @param {JobStatus[]} jobs one lane's jobs, oldest first
 * @param {number} now the browser's clock, milliseconds since the epoch
 * @returns {JobsSummary | null} null when every job has finished
 */
export function jobsSummary(jobs, now) {
  const unfinished = jobs.filter((job) => job.finishedAt === null);
  const shown = unfinished.find((job) => job.state === JOB_STATE.running) ?? unfinished[0];
  if (!shown) return null;
  const progress = jobProgress(shown, now);
  const more = unfinished.length - 1;
  const parts = [
    progress.title,
    ...(progress.fraction === null ? [] : [`${Math.round(progress.fraction * 100)}%`]),
    ...(more > 0 ? [`${more} more`] : []),
  ];
  const waiting =
    more > 0 ? ` ${more} more ${more === 1 ? "job waits" : "jobs wait"} behind it.` : "";
  return {
    id: shown.id,
    text: parts.join(" · "),
    title: `Job ${shown.id}: ${progress.step} ${progress.elapsed}${waiting}`,
    fraction: progress.fraction,
  };
}

/**
 * Each lane's summary, null for a lane with nothing unfinished.
 * @param {JobStatus[]} jobs every job, oldest first, as `GET /api/jobs` lists them
 * @param {number} now
 * @returns {Record<keyof typeof JOB_LANE, JobsSummary | null>}
 */
export function laneSummaries(jobs, now) {
  /** @param {string} lane */
  const summary = (lane) =>
    jobsSummary(
      jobs.filter((job) => jobLane(job.kind) === lane),
      now,
    );
  return { main: summary(JOB_LANE.main), words: summary(JOB_LANE.words) };
}

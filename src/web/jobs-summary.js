// What the top bar shows of the server's jobs: the one running, or the oldest waiting, with its
// count, and how many more wait behind it. No DOM here, so the wording is tested.
/** @import { JobStatus } from "./job-progress.js" */
import { JOB_STATE, jobProgress } from "./job-progress.js";

/**
 * @typedef {object} JobsSummary
 * @property {string} text what the bar reads, such as `Fitting the taste model · 40% · 2 more`
 * @property {string} title its tooltip: the job's step and how long it has run
 * @property {number | null} fraction from 0 to 1, or null while the job has no count
 */

/**
 * @param {JobStatus[]} jobs every job, oldest first, as `GET /api/jobs` lists them
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
    text: parts.join(" · "),
    title: `Job ${shown.id}: ${progress.step} ${progress.elapsed}${waiting}`,
    fraction: progress.fraction,
  };
}

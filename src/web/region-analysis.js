// A reference region's analysis as the References and brief pages read it (decision 0051):
// start the Analyze job and follow it, and say what it found in a sentence.
/** @import { JobStatus } from "./job-progress.js" */
import { windowsText } from "../domain/region-windows.js";
import { regionPath, startJob } from "./api.js";
import { followJob } from "./follow-job.js";
import { endedText, JOB_STATE, jobProgress } from "./job-progress.js";

/**
 * What the Analyze job returns.
 * @typedef {object} AnalyzeResult
 * @property {number} target LUFS
 * @property {number} windows
 * @property {boolean} embedded
 * @property {string | null} notEmbedded
 */

/**
 * Starts the Analyze job on a region and follows it to its end, passing each step to `say`.
 * Throws when another region's job holds the runner, and when the job fails or is cancelled,
 * with the job's own error when it has one.
 * @param {number} regionId
 * @param {number | null} vibeId the brief whose loudness target to measure at; null for 0018's
 * @param {(step: string) => void} say
 * @returns {Promise<AnalyzeResult>}
 */
export async function runAnalysis(regionId, vibeId, say) {
  const { job, refused } = await startJob(
    `${regionPath(regionId)}/analyze`,
    vibeId === null ? {} : { vibeId },
  );
  if (refused) throw new Error(refused);
  /** @type {JobStatus} */
  const finished = await followJob(job, (status) => say(jobProgress(status, Date.now()).step));
  if (finished.state !== JOB_STATE.done) throw new Error(finished.error ?? endedText(finished));
  return /** @type {AnalyzeResult} */ (finished.result);
}

/**
 * The job's result in a sentence or two.
 * @param {AnalyzeResult} result
 */
export function analysisText({ target, windows, embedded, notEmbedded }) {
  const measured = `Measured on ${windowsText(windows)} at ${target} LUFS.`;
  if (embedded) return `${measured} Its sound is analyzed too.`;
  return `${measured} Its sound isn't analyzed: ${notEmbedded ?? "no reason was given"}.`;
}

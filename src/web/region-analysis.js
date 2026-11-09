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
 * What the job measured on, behind the numbers toggle.
 * @param {AnalyzeResult} result
 */
export const analysisText = ({ target, windows }) =>
  `Measured on ${windowsText(windows)} at ${target} LUFS.`;

/**
 * The job's result in words (decision 0086): what the region can now be used for.
 * @param {AnalyzeResult} result
 */
export function analysisWords({ embedded, notEmbedded }) {
  const measured = "Measured the way an excerpt is";
  if (embedded) {
    return `${measured}, and its sound analyzed: a brief can take its ranges from this region, and a steer can aim toward it.`;
  }
  return `${measured}, so a brief can take its ranges from this region. Its sound isn't analyzed, so a steer can't aim toward it yet: ${notEmbedded ?? "no reason was given"}.`;
}

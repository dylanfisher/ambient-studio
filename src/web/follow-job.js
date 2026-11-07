// Follows a job until it finishes: reads its status every `POLL_MS`, each read waiting for the
// last, so slow replies never pile up (decision 0028).
/** @import { JobStatus } from "./job-progress.js" */
import { getJson, jobPath } from "./api.js";
import { POLL_MS } from "./poll-ms.js";

/**
 * @param {JobStatus} job its status as last read
 * @param {(status: JobStatus) => unknown} onStatus called with every status read, the first
 *   at once; a returned promise is waited for before the next read
 * @returns {Promise<JobStatus>} the finished status
 */
export async function followJob(job, onStatus) {
  let current = job;
  await onStatus(current);
  while (current.finishedAt === null) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    current = await getJson(jobPath(current.id));
    await onStatus(current);
  }
  return current;
}

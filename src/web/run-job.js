// Starts a job by its route and follows it in a box with Cancel, its buttons held off from the
// click until it ends (decision 0032). When the server refuses a second job and names the one
// already running (0031), that job is followed instead and the status line says so.
/** @import { JobControl } from "./job-control.js" */
/** @import { JobStatus } from "./job-progress.js" */
/** @import { StatusLine } from "./status-line.js" */
import { jobPath, postJson, startJob } from "./api.js";
import { followJob } from "./follow-job.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";

/**
 * @param {StatusLine} status
 * @param {object} options
 * @param {string} options.path the route a POST to starts the job
 * @param {Record<string, unknown>} options.body
 * @param {readonly JobControl[]} options.controls held while the job runs
 * @param {HTMLElement} options.boxes where the job's box goes
 * @param {string} options.started what the status line says once it has started
 * @returns {Promise<{ result: any, refused: string | null } | null>} once the job is done,
 *   its result and the server's refusal when the job followed was another; null when it
 *   stopped or failed, which the status line says
 */
export async function runJob(status, { path, body, controls, boxes, started }) {
  for (const control of controls) control.wait();
  try {
    const { job, refused } = await startJob(path, body);
    status.say(refused ? `${refused} Showing that job's progress.` : started);
    const box = jobBox((current) =>
      status.run(async () => box.show(await postJson(`${jobPath(current.id)}/cancel`, {}))),
    );
    boxes.replaceChildren(box.root);
    for (const control of controls) control.hold(job);
    /** @type {JobStatus & { result?: any }} */
    const finished = await followJob(job, (current) => box.show(current));
    if (finished.state !== JOB_STATE.done) {
      status.say(endedText(finished));
      return null;
    }
    return { result: finished.result, refused };
  } finally {
    for (const control of controls) control.release();
  }
}

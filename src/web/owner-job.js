// A button that starts a job only the owner starts, the embed job (decision 0042) or the fit job
// (0044), on the Model test page (0046): held off while its job runs, which a box beside it
// follows with its step and a Cancel. A job already running when the page opens is followed
// too, so a reload doesn't lose it.
/** @import { JobStatus } from "./job-progress.js" */
/** @import { statusLine } from "./status-line.js" */
import { jobPath, postJson, startJob } from "./api.js";
import { followJob } from "./follow-job.js";
import { jobControl } from "./job-control.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";
import { oneAtATime } from "./one-at-a-time.js";

/**
 * @param {ReturnType<typeof statusLine>} status the page's status line
 * @param {object} options
 * @param {HTMLButtonElement} options.button
 * @param {HTMLElement} options.boxes where the job's box goes
 * @param {string} options.path the route a POST to starts the job
 * @param {string} options.started what the status line says once it has started
 * @param {string} options.done what it says once the job is done
 * @returns {{ follow: (job: JobStatus) => Promise<void> }}
 */
export function ownerJob(status, { button, boxes, path, started, done }) {
  const control = jobControl(button);
  /** @type {ReturnType<typeof jobBox> | null} */
  let box = null;
  /** @type {number | null} */
  let following = null;

  /** @param {JobStatus} job */
  async function follow(job) {
    if (following === job.id) return;
    following = job.id;
    box?.root.remove();
    const made = jobBox((current) =>
      status.run(async () => made.show(await postJson(`${jobPath(current.id)}/cancel`, {}))),
    );
    box = made;
    boxes.append(made.root);
    control.hold(job);
    try {
      const finished = await followJob(job, (current) => made.show(current));
      status.say(finished.state === JOB_STATE.done ? done : endedText(finished));
    } finally {
      following = null;
      control.release();
    }
  }

  const start = oneAtATime(async () => {
    control.wait();
    try {
      const { job, refused } = await startJob(path, {});
      status.say(refused ? `${refused} Showing that job's progress.` : started);
      status.run(() => follow(job));
    } catch (error) {
      control.release();
      throw error;
    }
  });
  button.onclick = () => status.run(start);
  return { follow };
}

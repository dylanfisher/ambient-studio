// A button that starts a job only the owner starts, the embed job (decision 0042), the fit job
// (0044) or the optimizer test (0059), on the Model test page (0046): held off while its job
// runs, which a box beside it follows with its step and a Cancel. A job already running when
// the page opens is followed too, so a reload doesn't lose it.
/** @import { JobStatus } from "./job-progress.js" */
/** @import { statusLine } from "./status-line.js" */
import { jobPath, postJson, startJob } from "./api.js";
import { followJob } from "./follow-job.js";
import { jobControl } from "./job-control.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";
import { oneAtATime } from "./one-at-a-time.js";

/** What the status line says when the owner declines a confirm. */
export const NOT_STARTED = "Not started.";

/**
 * @param {ReturnType<typeof statusLine>} status the page's status line
 * @param {object} options
 * @param {HTMLButtonElement} options.button
 * @param {HTMLElement} options.boxes where the job's box goes
 * @param {string} options.path the route a POST to starts the job
 * @param {string} options.started what the status line says once it has started
 * @param {string} options.done what it says once the job is done
 * @param {() => Record<string, unknown> | null} [options.body] the body to start the job with,
 *   or null when the owner declines a confirm; `{}` when omitted
 * @param {() => Promise<void>} [options.onEnd] runs once the job has finished, however
 * @param {string} [options.ended] added to what the status line says when the job stopped or
 *   failed
 * @returns {{ follow: (job: JobStatus) => Promise<void> }}
 */
export function ownerJob(
  status,
  { button, boxes, path, started, done, body = () => ({}), onEnd = async () => {}, ended = "" },
) {
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
      status.say(
        finished.state === JOB_STATE.done
          ? done
          : [endedText(finished), ended].filter(Boolean).join(" "),
      );
    } finally {
      following = null;
      control.release();
    }
    await onEnd();
  }

  const start = oneAtATime(async () => {
    const sent = body();
    if (sent === null) {
      status.say(NOT_STARTED);
      return;
    }
    control.wait();
    try {
      const { job, refused } = await startJob(path, sent);
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

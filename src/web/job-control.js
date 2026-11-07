// A button that starts a job, held off from the click until that job finishes, with a title that
// says why, so one action queues one job (decision 0032). It reads only `disabled` and `title`,
// so it is tested without a DOM.
import { waitTitle } from "./job-progress.js";

/**
 * @typedef {object} JobControl
 * @property {(job: { id: number, kind: string }) => void} hold off, its title naming the job
 * @property {() => void} wait off while its request is sent, before a job id exists
 * @property {() => void} release back on, with the title it had
 * @property {() => boolean} held
 */

/**
 * @param {{ disabled: boolean, title: string }} button
 * @returns {JobControl}
 */
export function jobControl(button) {
  const idle = button.title;
  let held = false;
  return {
    hold(job) {
      held = true;
      button.disabled = true;
      button.title = waitTitle(job);
    },
    wait() {
      held = true;
      button.disabled = true;
      button.title =
        "Turned off while the request is sent; it turns back on if the server refuses it.";
    },
    release() {
      held = false;
      button.disabled = false;
      button.title = idle;
    },
    held: () => held,
  };
}

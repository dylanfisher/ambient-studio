// The explore and nudge controls of a session card or a lineage node (decision 0039), from the
// page's `steer-controls` template: a direction field with the explore button, and a step size
// with the nudge button. Each button is off from its click until its job finishes (0032). The
// page sends the request and follows the job; this builds the request.
/** @import { JobControl } from "./job-control.js" */
import { DIRECTION_CHARS, NOT_ONE_LINE } from "../domain/explore-direction.js";
import { STEP_SIZE } from "../domain/nudge.js";
import { sessionPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { jobControl } from "./job-control.js";

/** Each step size as the select shows it. A size without words here throws. */
const STEP_WORDS = Object.freeze({
  small: "Small step",
  medium: "Medium step",
  large: "Large step",
});

/**
 * Sends a job's request and follows the job. The control is off until the job finishes.
 * @typedef {(control: JobControl, path: string, body: Record<string, unknown>) => Promise<void>} StartJob
 */

/**
 * @typedef {object} SteerControls
 * @property {HTMLElement} root
 * @property {() => boolean} unsent whether the direction field holds text not yet sent
 * @property {(why: string | null) => void} off turns both buttons off with `why` as their
 *   title, or back on with null, unless a job of theirs is unfinished
 */

/**
 * @param {object} options
 * @param {number} options.candidateId the base
 * @param {() => number | null} options.sessionId the session the children go to, or null
 *   when there is none to send to
 * @param {StartJob} options.start
 * @param {(work: () => unknown) => Promise<void>} options.run runs a click, showing its error
 * @returns {SteerControls}
 */
export function steerControls({ candidateId, sessionId, start, run }) {
  const parts = cloneTemplate("steer-controls", {
    direction: HTMLInputElement,
    explore: HTMLButtonElement,
    stepSize: HTMLSelectElement,
    nudge: HTMLButtonElement,
  });
  parts.direction.maxLength = DIRECTION_CHARS;
  parts.stepSize.replaceChildren(
    ...Object.keys(STEP_SIZE).map((size) => {
      const words = STEP_WORDS[/** @type {keyof typeof STEP_WORDS} */ (size)];
      if (words === undefined) throw new Error(`no words for the step size ${size}`);
      const option = document.createElement("option");
      option.value = size;
      option.textContent = words;
      return option;
    }),
  );
  const explore = jobControl(parts.explore);
  const nudge = jobControl(parts.nudge);

  /** @returns {number} */
  const session = () => {
    const id = sessionId();
    if (id === null) throw new Error("There is no open session to send this to.");
    return id;
  };
  parts.explore.onclick = () =>
    run(async () => {
      const line = parts.direction.value;
      if (NOT_ONE_LINE.test(line)) {
        throw new Error("The direction must be one line of text, with no tabs or line breaks.");
      }
      const direction = line.trim() === "" ? null : line;
      await start(explore, `${sessionPath(session())}/explores`, { candidateId, direction });
      parts.direction.value = "";
    });
  parts.nudge.onclick = () =>
    run(() =>
      start(nudge, `${sessionPath(session())}/nudges`, {
        candidateId,
        stepSize: parts.stepSize.value,
      }),
    );

  /** @type {WeakMap<HTMLButtonElement, string>} */
  const idle = new WeakMap([
    [parts.explore, parts.explore.title],
    [parts.nudge, parts.nudge.title],
  ]);
  return {
    root: parts.root,
    unsent: () => parts.direction.value.trim() !== "",
    off(why) {
      for (const [control, button] of /** @type {const} */ ([
        [explore, parts.explore],
        [nudge, parts.nudge],
      ])) {
        if (control.held()) continue;
        button.disabled = why !== null;
        button.title = why ?? /** @type {string} */ (idle.get(button));
      }
    },
  };
}

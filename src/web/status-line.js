// The line at the top of each page that says what the last action did, or why it failed. An
// action's error is shown there and logged, never swallowed.
import { elementById } from "./element-by-id.js";

/**
 * @typedef {object} StatusLine
 * @property {(message: string) => void} say
 * @property {(error: unknown) => void} fail shows and logs an error
 * @property {(work: () => unknown) => Promise<void>} run runs an action, showing its error
 */

/**
 * The page's `#status` line.
 * @returns {StatusLine}
 */
export function statusLine() {
  const element = elementById("status", HTMLElement);
  /**
   * @param {string} message
   * @param {boolean} failed
   */
  const show = (message, failed) => {
    element.textContent = message;
    element.classList.toggle("failed", failed);
  };
  /** @param {unknown} error */
  const fail = (error) => {
    console.error(error);
    show(error instanceof Error ? error.message : String(error), true);
  };
  return {
    say: (message) => show(message, false),
    fail,
    async run(work) {
      try {
        await work();
      } catch (error) {
        fail(error);
      }
    },
  };
}

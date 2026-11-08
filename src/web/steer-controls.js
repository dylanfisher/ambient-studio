// The explore, nudge and search controls of a session card or a lineage node (decisions 0039,
// 0054), from the page's `steer-controls` template: a direction field with the explore button,
// a step size with the nudge button, a budget and control switch with the search button,
// which asks first with the cost, and a count of pairs with Search by ear, which opens the
// Quick A/B page in its search-by-ear mode (0055). Each button is off from its click until its job finishes
// (0032). The page sends the request and follows the job; this builds the request.
/** @import { JobControl } from "./job-control.js" */
import { DEFAULT_EAR_QUERIES, MAX_EAR_QUERIES } from "../domain/ear-settings.js";
import { DEFAULT_EXPLORES, DIRECTION_CHARS, NOT_ONE_LINE } from "../domain/explore-direction.js";
import { DEFAULT_NUDGES, STEP_SIZE } from "../domain/nudge.js";
import { searchCostText } from "../domain/search-cost.js";
import { DEFAULT_SEARCH_BUDGET, MAX_SEARCH_BUDGET } from "../domain/search-settings.js";
import { SHOWN_POINTS } from "../domain/search-shown.js";
import { ApiError, getJson, postJson, SEARCH_ESTIMATE_PATH, sessionPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { jobControl } from "./job-control.js";

/** Each step size as the select shows it. A size without words here throws. */
const STEP_WORDS = Object.freeze({
  small: "Small step",
  medium: "Medium step",
  large: "Large step",
});

/**
 * The two buttons' titles, with the counts each request sends, so a title can't name another
 * count than the one asked for.
 */
export const steerTitles = () => ({
  explore: `Asks the model for ${DEFAULT_EXPLORES} variations of this candidate, following the direction if you wrote one, and renders an excerpt of each. Takes about 1–2 minutes per variation.`,
  nudge: `Makes ${DEFAULT_NUDGES} children of this candidate by moving its numbers a step, with no model request, and renders an excerpt of each. Takes a few seconds per child.`,
  search: `Searches near this candidate, scoring each point by your taste model with no model request, and shows the best ${SHOWN_POINTS} that sound different, the rest folded under them. Asks first, with the time it takes.`,
  budget: `How many points Search from here tries, from 1 to ${MAX_SEARCH_BUDGET}. Each one renders an excerpt and is scored by your taste model.`,
  ear: "Searches near this candidate by your ear: opens Quick A/B, where the best so far meets one new variation at a time, and each choice steers the next. No model request; the next variation renders while you listen.",
  queries: `How many pairs Search by ear asks you, from 1 to ${MAX_EAR_QUERIES}. Each takes about as long as hearing the two excerpts.`,
});

/** Why a card's job button sends nothing: the page has no open session. */
export const NO_SESSION = "There is no open session to send this to.";

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
    budget: HTMLInputElement,
    control: HTMLInputElement,
    search: HTMLButtonElement,
    queries: HTMLInputElement,
    ear: HTMLButtonElement,
  });
  parts.queries.min = "1";
  parts.queries.max = String(MAX_EAR_QUERIES);
  parts.queries.value = String(DEFAULT_EAR_QUERIES);
  parts.budget.min = "1";
  parts.budget.max = String(MAX_SEARCH_BUDGET);
  parts.budget.value = String(DEFAULT_SEARCH_BUDGET);
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
  const titles = steerTitles();
  parts.explore.title = titles.explore;
  parts.nudge.title = titles.nudge;
  parts.search.title = titles.search;
  parts.budget.title = titles.budget;
  parts.ear.title = titles.ear;
  parts.queries.title = titles.queries;
  const explore = jobControl(parts.explore);
  const nudge = jobControl(parts.nudge);
  const search = jobControl(parts.search);

  /** @returns {number} */
  const session = () => {
    const id = sessionId();
    if (id === null) throw new Error(NO_SESSION);
    return id;
  };
  parts.explore.onclick = () =>
    run(async () => {
      const line = parts.direction.value;
      if (NOT_ONE_LINE.test(line)) {
        throw new Error("The direction must be one line of text, with no tabs or line breaks.");
      }
      const direction = line.trim() === "" ? null : line;
      await start(explore, `${sessionPath(session())}/explores`, {
        candidateId,
        direction,
        count: DEFAULT_EXPLORES,
      });
      parts.direction.value = "";
    });
  parts.nudge.onclick = () =>
    run(() =>
      start(nudge, `${sessionPath(session())}/nudges`, {
        candidateId,
        stepSize: parts.stepSize.value,
        count: DEFAULT_NUDGES,
      }),
    );

  parts.search.onclick = () =>
    run(async () => {
      const budget = Number(parts.budget.value);
      if (!Number.isInteger(budget) || budget < 1 || budget > MAX_SEARCH_BUDGET) {
        throw new Error(
          `The search's points must be a whole number from 1 to ${MAX_SEARCH_BUDGET}.`,
        );
      }
      const control = parts.control.checked;
      const path = `${sessionPath(session())}/searches`;
      /** @type {{ seconds: import("../domain/search-cost.js").StepSeconds, measured: boolean }} */
      const { seconds, measured } = await getJson(SEARCH_ESTIMATE_PATH);
      if (!confirm(searchCostText(budget, seconds, { measured, control }))) return;
      await start(search, path, { candidateId, budget, control });
    });

  // The search runs on the Quick A/B page, so this button opens it rather than following a job
  // here; a search by ear already running in the session is opened as it is.
  parts.ear.onclick = () =>
    run(async () => {
      const queries = Number(parts.queries.value);
      if (!Number.isInteger(queries) || queries < 1 || queries > MAX_EAR_QUERIES) {
        throw new Error(
          `Search by ear's pairs must be a whole number from 1 to ${MAX_EAR_QUERIES}.`,
        );
      }
      const id = session();
      try {
        await postJson(`${sessionPath(id)}/ear-searches`, { candidateId, queries });
      } catch (error) {
        const running = error instanceof ApiError && error.status === 409 && error.body?.jobId;
        if (!running) throw error;
      }
      location.assign(`./quick-ab.html?id=${id}&ear`);
    });

  /** @type {WeakMap<HTMLButtonElement, string>} */
  const idle = new WeakMap([
    [parts.explore, parts.explore.title],
    [parts.nudge, parts.nudge.title],
    [parts.search, parts.search.title],
  ]);
  return {
    root: parts.root,
    unsent: () => parts.direction.value.trim() !== "",
    off(why) {
      for (const [control, button] of /** @type {const} */ ([
        [explore, parts.explore],
        [nudge, parts.nudge],
        [search, parts.search],
      ])) {
        if (control.held()) continue;
        button.disabled = why !== null;
        button.title = why ?? /** @type {string} */ (idle.get(button));
      }
      parts.ear.disabled = why !== null;
      parts.ear.title = why ?? titles.ear;
    },
  };
}

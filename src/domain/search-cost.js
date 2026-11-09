// What a model-in-the-loop search costs, said in its confirm before it starts (decision 0054):
// its evaluations times the seconds to render and to embed one, from the medians of the last
// search, or the bench before any. Scoring by the taste model takes milliseconds and isn't
// counted. No DOM here, so the wording is tested.
import { percentiles } from "./percentiles.js";

/**
 * Seconds per excerpt before any search has run: 1.3 to 2.5 s to render one in the logged model
 * tests on mbp2021, and 0.17 s to embed a 30 s excerpt warm in 4b's bench (decision 0042).
 */
export const BENCH_SECONDS = Object.freeze({ render: 2, embed: 0.17 });

/** @typedef {{ render: number, embed: number }} StepSeconds */

/**
 * @param {number} evaluations
 * @param {StepSeconds} seconds per evaluation
 */
export const searchSeconds = (evaluations, { render, embed }) => evaluations * (render + embed);

/**
 * The minutes `evaluations` take, rounded, and at least 1, as every confirm says them.
 * @param {number} evaluations
 * @param {StepSeconds} seconds per evaluation
 */
export const searchMinutes = (evaluations, seconds) =>
  Math.max(1, Math.round(searchSeconds(evaluations, seconds) / 60));

/**
 * Each step's median, nearest rank, so each figure is one that was measured.
 * @param {readonly StepSeconds[]} timings one per evaluation
 * @returns {StepSeconds}
 */
export function medianTimings(timings) {
  return {
    render: percentiles(timings.map(({ render }) => render)).p50,
    embed: percentiles(timings.map(({ embed }) => embed)).p50,
  };
}

/**
 * Each evaluation's share of a batch that ran them side by side (decision 0076): its own render
 * and embed seconds scaled so that all of them add up to the batch's wall time. A median of
 * these, times the evaluations, is then what a batch of them takes.
 * @param {readonly StepSeconds[]} timings each evaluation's own, timed from its start to its end
 * @param {number} wall seconds the whole batch took
 * @returns {StepSeconds[]}
 */
export function wallShares(timings, wall) {
  const total = timings.reduce((sum, { render, embed }) => sum + render + embed, 0);
  if (total === 0) return timings.map((each) => ({ ...each }));
  const scale = wall / total;
  return timings.map(({ render, embed }) => ({ render: render * scale, embed: embed * scale }));
}

/** @param {number} n @param {string} word */
const counted = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {number} evaluations
 * @param {StepSeconds} seconds per evaluation
 * @param {{ measured: boolean, control: boolean }} options `measured` when `seconds` are the
 *   last search's medians, not the bench; `control` when a control arm of as many nudges runs
 *   after the search
 * @returns {string} the confirm's question and its cost
 */
export function searchCostText(evaluations, seconds, { measured, control }) {
  const arms = control ? 2 : 1;
  const minutes = searchMinutes(arms * evaluations, seconds);
  const then = control
    ? `, then ${evaluations} medium nudges of it as a control that isn't shown`
    : "";
  return (
    `Search from this candidate with ${counted(evaluations, "evaluation")}${then}? ` +
    "Each renders an excerpt, analyzes its sound and scores it by your taste model; nothing is sent to the language model. " +
    costLine(minutes, seconds, measured)
  );
}

/**
 * The optimizer test's confirm (decision 0059): every brief's runs, each a search and its
 * control of `budget` evaluations.
 * @param {number} briefs
 * @param {number} runs per brief
 * @param {number} budget evaluations per search
 * @param {StepSeconds} seconds per evaluation
 * @param {{ measured: boolean }} options as `searchCostText`'s
 * @returns {string}
 */
export function optimizerTestCostText(briefs, runs, budget, seconds, { measured }) {
  const evaluations = briefs * runs * 2 * budget;
  const minutes = searchMinutes(evaluations, seconds);
  return (
    `Run the optimizer test on ${briefs} brief${briefs === 1 ? "" : "s"}? ` +
    `Each brief gets ${runs} search${runs === 1 ? "" : "es"} of ${counted(budget, "evaluation")}, each followed by ${budget} medium nudges of the same start as its control, ${evaluations} evaluations in all. ` +
    "Each renders an excerpt, analyzes its sound and scores it by your taste model; nothing is sent to the language model. " +
    costLine(minutes, seconds, measured)
  );
}

/**
 * The confirm's last sentence: the time, and where its figures come from.
 * @param {number} minutes
 * @param {StepSeconds} seconds
 * @param {boolean} measured
 */
function costLine(minutes, seconds, measured) {
  const source = measured
    ? "the medians of the last search"
    : "from the bench, since no search has run yet";
  return `That is about ${counted(minutes, "minute")}, at ${seconds.render} s to render and ${seconds.embed} s to analyze each, ${source}.`;
}

/**
 * A steer's confirm (decision 0056): a search with no control, scored by the sliders and
 * regions.
 * @param {number} evaluations
 * @param {StepSeconds} seconds per evaluation
 * @param {{ measured: boolean }} options as `searchCostText`'s
 * @returns {string}
 */
export function steerCostText(evaluations, seconds, { measured }) {
  const minutes = searchMinutes(evaluations, seconds);
  return (
    `Steer from this candidate with ${counted(evaluations, "evaluation")}? ` +
    "Each renders an excerpt, analyzes its sound and scores it by where it sits on the sliders you moved and how near it is to the regions you chose, and a little by your taste model when the brief has one; nothing is sent to the language model. " +
    costLine(minutes, seconds, measured)
  );
}

/**
 * A fill's minutes: its steps, and its control arm's as many nudges.
 * @param {number} steps
 * @param {StepSeconds} seconds
 * @param {boolean} control
 */
const fillMinutes = (steps, seconds, control) => searchMinutes((control ? 2 : 1) * steps, seconds);

/**
 * The map's fill's confirm (decision 0057): its steps, and the control's as many nudges, at the
 * search's seconds each, and the requests to the language model its explore steps make.
 * @param {number} steps
 * @param {number} explores how many of the steps ask the model
 * @param {StepSeconds} seconds per evaluation
 * @param {{ measured: boolean, control: boolean }} options as `searchCostText`'s
 * @returns {string}
 */
export function fillCostText(steps, explores, seconds, { measured, control }) {
  const minutes = fillMinutes(steps, seconds, control);
  const then = control
    ? `, then ${steps} medium nudges from the same starts as a control that isn't shown`
    : "";
  const asked =
    explores === 0
      ? "Nothing is sent to the language model. "
      : `${counted(explores, "step")} of them ask the language model for a variation, ${counted(explores, "request")} to it, which wait their turn and add their own time. `;
  return (
    `Fill the map with ${counted(steps, "step")}${then}? ` +
    "Each nudges a candidate beside an empty cell, renders the excerpt and places it on the map. " +
    asked +
    costLine(minutes, seconds, measured)
  );
}

/**
 * The map's fill as time, the line beside Fill the map (decision 0086): the confirm's minutes,
 * with the steps and their seconds behind the numbers toggle.
 * @param {number} steps
 * @param {number} explores how many of the steps ask the model
 * @param {StepSeconds} seconds per evaluation
 * @param {{ control: boolean }} options as `fillCostText`'s
 * @returns {string}
 */
export function fillTimeText(steps, explores, seconds, { control }) {
  const minutes = fillMinutes(steps, seconds, control);
  const asking =
    explores === 0
      ? ""
      : ", and longer for the steps that ask the language model, which wait their turn";
  return `A fill with the settings now takes about ${counted(minutes, "minute")}${asking}.`;
}

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
  const minutes = Math.max(1, Math.round(searchSeconds(arms * evaluations, seconds) / 60));
  const then = control
    ? `, then ${evaluations} medium nudges of it as a control that isn't shown`
    : "";
  const source = measured
    ? "the medians of the last search"
    : "from the bench, since no search has run yet";
  return (
    `Search from this candidate with ${counted(evaluations, "evaluation")}${then}? ` +
    "Each renders an excerpt, analyzes its sound and scores it by your taste model; nothing is sent to the language model. " +
    `That is about ${counted(minutes, "minute")}, at ${seconds.render} s to render and ${seconds.embed} s to analyze each, ${source}.`
  );
}

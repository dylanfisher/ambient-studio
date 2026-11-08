// The map's fill job's settings (decision 0057): a budget of steps, each a medium nudge of an
// elite beside an empty cell, and the share of steps that ask the language model to explore
// toward the empty side instead, none by default.
import { MAX_SEARCH_BUDGET, SEARCH_STEP_SIZE } from "./search-settings.js";

/** Steps a fill takes when the owner doesn't say. */
export const DEFAULT_FILL_BUDGET = 200;
/** A search's cap: at about 2 s a step, a quarter of an hour of renders. */
export const MAX_FILL_BUDGET = MAX_SEARCH_BUDGET;
/** A fill nudges at the medium step, as a search starts at it, so the control compares. */
export const FILL_STEP_SIZE = SEARCH_STEP_SIZE;

/**
 * Whether step `step` (from 0) asks the model to explore: the steps where the running count of
 * `share × steps` reaches its next whole number, so 0.25 makes steps 4, 8, 12 and so on explores.
 * @param {number} step
 * @param {number} share from 0 to 1
 */
export const isExploreStep = (step, share) =>
  Math.floor((step + 1) * share) > Math.floor(step * share);

/**
 * How many of `budget` steps explore at `share`.
 * @param {number} budget
 * @param {number} share
 */
export const exploreSteps = (budget, share) => Math.floor(budget * share);

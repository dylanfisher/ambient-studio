// A model-in-the-loop search's settings (decision 0054): CMA-ES from the base's position, at the
// medium nudge's step, a population of 4 + ⌊3 ln d⌋ (Hansen's default), and a budget of points.
import { STEP_SIZE } from "./nudge.js";

/** The sidecar's name for the optimizer, in its `OPTIMIZERS`. */
export const SEARCH_OPTIMIZER = "cma-es";

/** The starting step, in vector-view positions: the medium nudge's, so the two compare. */
export const SEARCH_STEP_SIZE = /** @type {const} */ ("medium");
export const SEARCH_SIGMA = STEP_SIZE[SEARCH_STEP_SIZE];

/** Points a search asks for, rejected ones included, when the owner doesn't say. */
export const DEFAULT_SEARCH_BUDGET = 96;
/** At about 2 s a point, 400 is a quarter of an hour of renders. */
export const MAX_SEARCH_BUDGET = 400;
/** Points a steer asks for when the owner doesn't say (decision 0056): a slider is a small move. */
export const DEFAULT_STEER_BUDGET = 32;

/**
 * Points per generation in `dimensions` dimensions.
 * @param {number} dimensions from 1
 */
export const searchPopulation = (dimensions) => 4 + Math.floor(3 * Math.log(dimensions));

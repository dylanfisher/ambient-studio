// Effective parameters are sampled at absolute timeline times, multiples of one step from 0,
// and ramped linearly between samples, so an excerpt and a full render sample at the same times
// (decisions 0007 and 0010).

/** Control-grid samples per timeline second. */
export const CONTROL_RATE = 10;

/**
 * The timeline time of grid sample `index`, computed the same way by every render.
 * @param {number} index
 */
export const controlTime = (index) => index / CONTROL_RATE;

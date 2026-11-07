// A macro's effective value over the excerpt the owner heard, stored with "more / less like
// this" feedback (decision 0027). A macro may be a trajectory, so one number at one time would
// misstate what was heard.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
import { effectiveParams } from "../engine/effective-params.js";

/** Seconds between samples. Trajectory points are seconds apart at the finest, in practice. */
const STEP_SECONDS = 1;

/**
 * @typedef {object} MacroWindow
 * @property {number} min
 * @property {number} max
 * @property {number} mean over samples every `STEP_SECONDS` from the window's start to its end,
 *   both ends included
 */

/**
 * @param {Genome} genome a normalized genome
 * @param {MacroName} macro
 * @param {number} offset the window's start, timeline seconds
 * @param {number} duration seconds
 * @returns {MacroWindow}
 */
export function macroWindow(genome, macro, offset, duration) {
  const steps = Math.ceil(duration / STEP_SECONDS);
  const values = Array.from({ length: steps + 1 }, (_, i) => {
    const time = offset + Math.min(i * STEP_SECONDS, duration);
    return effectiveParams(genome, time).macros[macro];
  });
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

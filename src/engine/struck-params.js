// What the struck voices' tables share (decision 0071), apart from struck.js: a voice module
// reads these while it loads, and struck.js imports the voice registry back through
// effective-params.js, so it may not have finished loading then.
/** @import { NumberDescriptor } from "./descriptor.js" */
/** @import { MacroRow } from "./macro-table.js" */
import { number } from "./descriptor.js";
import { MACRO } from "./macro-table.js";

/** The slot of a hit's delay from its candidate's time; a voice numbers its own draws above it. */
export const JITTER_SLOT = 1;

/** Every struck voice's density macro row. */
export const DENSITY_ROW = /** @type {MacroRow} */ (
  Object.freeze({ macro: MACRO.density, param: "density", depth: 0.25 })
);

/**
 * A struck voice's `density` descriptor: hits a minute, from 0.5, a trajectory.
 * @param {{ max: number; default: number; safe: [number, number]; description?: string }} range
 * @returns {NumberDescriptor}
 */
export const strikeDensity = ({ max, default: value, safe, description = "hits" }) =>
  number({
    min: 0.5,
    max,
    default: value,
    unit: "/min",
    scale: "log",
    trajectory: true,
    safe,
    description,
  });

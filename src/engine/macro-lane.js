// The rules of a track's macro lanes that decide a section's macros (decision 0065). A lane's
// offsets are written into each section's genome as a trajectory, which a track's manifest holds;
// these are the rules that turn a lane into those points, listed in the manifest beside them.
// Changing one changes the genomes a laned track renders, and so its samples.
/** @import { Curve } from "./trajectory.js" */
import { MAX_POINTS } from "./trajectory.js";

/**
 * Seconds between the samples a section's laned macro takes, beside the lane's and the
 * section's own breakpoints: multiples of this from the track's start.
 */
export const LANE_SAMPLE_SECONDS = 10;

/** The most points a section's laned macro holds: a trajectory's. */
export const LANE_POINTS = MAX_POINTS;

/**
 * The curve between a laned macro's points. The sum of two curves is neither of them, so the
 * points are joined evenly and are exact only where they fall.
 * @type {Curve}
 */
export const LANE_CURVE = "linear";

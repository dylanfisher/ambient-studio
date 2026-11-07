// The seed vibes the owner can load from the vibe list (decision 0030), one import line per file
// in ./vibes/. The browser can't list a folder, so a new file needs its line here; a test fails
// when the folder and this list disagree.
/** @import { Constraints } from "./constraint-schema.js" */
import bellField from "./vibes/bell-field.js";
import coldDorian from "./vibes/cold-dorian.js";
import tidalNoise from "./vibes/tidal-noise.js";

/**
 * A vibe's first draft, as the vibe routes take one.
 * @typedef {object} SeedVibe
 * @property {string} name
 * @property {string} brief
 * @property {Constraints} constraints
 * @property {Record<string, unknown>} softTargets
 */

/** @type {Readonly<Record<string, SeedVibe>>} file name without `.js` → the seed */
export const SEED_VIBES = Object.freeze({
  "cold-dorian": coldDorian,
  "bell-field": bellField,
  "tidal-noise": tidalNoise,
});

// The seed vibes the owner can load from the vibe list (decision 0030): one JSON file each in
// ./vibes/, in the shape the vibe routes take, so the owner can edit or replace one by hand. A
// new file needs its line here; a test fails when the folder and this list disagree.
/** @import { Constraints } from "./constraint-schema.js" */
import bellField from "./vibes/bell-field.json" with { type: "json" };
import coldDorian from "./vibes/cold-dorian.json" with { type: "json" };
import tidalNoise from "./vibes/tidal-noise.json" with { type: "json" };

/**
 * A vibe's first draft, as the vibe routes take one. The server checks the constraints when it
 * loads one, as it does any draft.
 * @typedef {object} SeedVibe
 * @property {string} name
 * @property {string} brief
 * @property {Constraints} constraints
 * @property {Record<string, unknown>} softTargets
 */

/** @type {Readonly<Record<string, SeedVibe>>} file name without `.json` → the seed */
export const SEED_VIBES = Object.freeze({
  "cold-dorian": /** @type {SeedVibe} */ (coldDorian),
  "bell-field": /** @type {SeedVibe} */ (bellField),
  "tidal-noise": /** @type {SeedVibe} */ (tidalNoise),
});

// A search by ear's settings and what it tells its optimizer (decision 0055): preferential BO in
// the sidecar, one new point a query against the run's best, drawn at the owner's variation and
// leaning toward the owner's shift (0075).
import { isObject } from "../engine/is-object.js";
import { STEP_SIZE } from "./nudge.js";
import { OUTCOMES } from "./rating-values.js";

const [A, B, TIE, SKIP] = OUTCOMES;

/** The sidecar's name for the optimizer, in its `OPTIMIZERS`. */
export const EAR_OPTIMIZER = "preferential-bo";

/**
 * How far each new point may sit from the best, by the name the page shows: the step in
 * vector-view positions, a nudge's for the first three (decision 0075).
 */
export const EAR_VARIATION = Object.freeze({
  subtle: STEP_SIZE.small,
  medium: STEP_SIZE.medium,
  wide: STEP_SIZE.large,
  wider: 0.4,
});

/** @typedef {keyof typeof EAR_VARIATION} EarVariation */

/** The variation a search starts at: wider than the medium step, which sounded too alike. */
const DEFAULT_EAR_VARIATION = /** @type {const} */ ("wide");

/**
 * How a search by ear leans each new point: a variation, and for each searched path a shift
 * from -1 (less) to 1 (more), the paths it doesn't name at 0.
 * @typedef {{ variation: EarVariation, shift: Record<string, number> }} EarSteering
 */

/** The steering a search starts with: the default variation and no shift. */
export const START_STEERING = Object.freeze({ variation: DEFAULT_EAR_VARIATION, shift: {} });

/** Points drawn near the best for each query, of which expected improvement picks one. */
export const EAR_DRAWS = 1000;

/** Queries a search by ear asks when the owner doesn't say: about 20 minutes of listening. */
export const DEFAULT_EAR_QUERIES = 20;
/** At a minute or so a query, 60 is an hour of listening. */
export const MAX_EAR_QUERIES = 60;

/**
 * How long a pair waits for a choice before the search stops as Stop does: well past the 50 s
 * two excerpts take to hear twice over, and short enough that a closed tab or a walk away
 * frees the one job runner within minutes.
 */
export const EAR_IDLE_MS = 10 * 60 * 1000;

/** The most dimensions a search by ear takes: a GP fitted to tens of choices learns no more. */
export const MAX_EAR_DIMENSIONS = 12;

/**
 * Points in a row the linter may reject before the run gives up: each is told as a loss and
 * drawn again, and a run near the linter's edges would otherwise ask without end.
 */
export const EAR_REJECTS = 8;

/**
 * What a search by ear is doing, as the server reports it and the page reads it: drawing and
 * rendering a pair, waiting for the owner's choice on it, or finished.
 */
export const EAR_PHASE = Object.freeze({
  drawing: "drawing",
  listening: "listening",
  finished: "finished",
});

/** What the optimizer is told of a new point: it beat the run's best, tied with it, or lost. */
export const EAR_SCORE = Object.freeze({ win: 1, tie: 0.5, loss: 0 });

/**
 * What a rating of the best against a new point tells the optimizer of the new point: a score
 * from `EAR_SCORE`, or null for a skip, which tells nothing.
 * @param {(typeof OUTCOMES)[number]} outcome the rating's
 * @param {"a" | "b"} side the rating's side that holds the new point
 * @returns {number | null}
 */
export function earScore(outcome, side) {
  if (outcome === SKIP) return null;
  if (outcome === TIE) return EAR_SCORE.tie;
  if (outcome !== A && outcome !== B) throw new Error(`a rating has no outcome ${outcome}`);
  return outcome === side ? EAR_SCORE.win : EAR_SCORE.loss;
}

/**
 * The optimizer's settings for `steering` over `paths`: the reach, and each path's drift,
 * 0 where the shift names none (decision 0075).
 * @param {EarSteering} steering
 * @param {readonly string[]} paths the run's, in its vector's order
 * @returns {{ reach: number, drift: number[] }}
 */
export const earSettings = ({ variation, shift }, paths) => ({
  reach: EAR_VARIATION[variation],
  drift: paths.map((path) => shift[path] ?? 0),
});

/**
 * The steering a body asks for, checked against the run's paths, or the reason it can't be:
 * a variation `EAR_VARIATION` names, and a shift that names only searched paths, each from -1
 * to 1. A shift of 0 is dropped, so a shift equals another that leans the same way.
 * @param {unknown} variation
 * @param {unknown} shift
 * @param {readonly string[]} paths
 * @returns {{ ok: true, steering: EarSteering } | { ok: false, error: string }}
 */
export function checkSteering(variation, shift, paths) {
  const variations = Object.keys(EAR_VARIATION);
  if (!variations.includes(/** @type {any} */ (variation))) {
    const got = JSON.stringify(variation);
    return { ok: false, error: `variation must be one of ${variations.join(", ")}, got ${got}` };
  }
  if (!isObject(shift)) {
    const error = "shift must be an object of searched paths, each a number from -1 to 1";
    return { ok: false, error };
  }
  /** @type {Record<string, number>} */
  const kept = {};
  for (const [path, given] of Object.entries(shift)) {
    // Number.isFinite is false for anything but a finite number.
    const value = /** @type {number} */ (given);
    if (!paths.includes(path)) {
      return { ok: false, error: `the shift names ${path}, which this search doesn't move` };
    }
    if (!Number.isFinite(value) || !(value >= -1 && value <= 1)) {
      const got = JSON.stringify(value);
      return { ok: false, error: `the shift of ${path} must be a number from -1 to 1, got ${got}` };
    }
    if (value !== 0) kept[path] = value;
  }
  return {
    ok: true,
    steering: { variation: /** @type {EarVariation} */ (variation), shift: kept },
  };
}

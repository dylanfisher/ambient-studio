// A search by ear's settings and what it tells its optimizer (decision 0055): preferential BO in
// the sidecar, one new point a query against the run's best, drawn at the medium nudge's step.
import { OUTCOMES } from "./rating-values.js";

const [A, B, TIE, SKIP] = OUTCOMES;

/** The sidecar's name for the optimizer, in its `OPTIMIZERS`. */
export const EAR_OPTIMIZER = "preferential-bo";

/** Points drawn near the best for each query, of which expected improvement picks one. */
export const EAR_DRAWS = 1000;

/** Queries a search by ear asks when the owner doesn't say: about 20 minutes of listening. */
export const DEFAULT_EAR_QUERIES = 20;
/** At a minute or so a query, 60 is an hour of listening. */
export const MAX_EAR_QUERIES = 60;

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

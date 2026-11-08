// Which points of a model-in-the-loop search the session shows (decision 0054). A run evaluates
// a hundred or more points, most of them small moves around a few good ones, so the session
// shows the best few that sound different, and folds every other point under the shown one
// whose sound is nearest.
import { meanSimilarity } from "./mean-similarity.js";

/** How many points of a run the session shows. */
export const SHOWN_POINTS = 4;

/**
 * The least cosine distance (1 − cosine similarity) in CLAP's space between two shown points.
 * Provisional, until the owner has heard runs: a nearer point is taken to sound like the one
 * shown.
 */
export const MIN_SHOWN_DISTANCE = 0.02;

/**
 * @typedef {object} ScoredPoint
 * @property {number} id the point's candidate
 * @property {number} score its `searchScore`
 * @property {ArrayLike<number>} embedding its excerpt's
 */

/** @param {ScoredPoint} a @param {ScoredPoint} b */
const distance = (a, b) =>
  1 - meanSimilarity([Float32Array.from(a.embedding)], Float32Array.from(b.embedding));

/**
 * Greedy by score, highest first, a tie to the point evaluated first: a point is shown when it
 * sits at least `MIN_SHOWN_DISTANCE` from every point shown before it, until `SHOWN_POINTS`.
 * Every other point is folded under the shown point nearest it, a tie to the better shown.
 * @param {readonly ScoredPoint[]} scored the run's valid points, in the order evaluated
 * @returns {{ shown: number[], foldedUnder: Map<number, number> }} shown ids, best first, and
 *   each other point's id with the id it folds under
 */
export function shownPoints(scored) {
  if (!scored.every(({ score }) => Number.isFinite(score))) {
    throw new Error("a shown point's score must be finite");
  }
  const order = scored.map((point, index) => ({ point, index }));
  order.sort((x, y) => y.point.score - x.point.score || x.index - y.index);
  /** @type {ScoredPoint[]} */
  const shown = [];
  for (const { point } of order) {
    if (shown.length === SHOWN_POINTS) break;
    if (shown.every((other) => distance(point, other) >= MIN_SHOWN_DISTANCE)) shown.push(point);
  }
  /** @type {Map<number, number>} */
  const foldedUnder = new Map();
  for (const point of scored) {
    if (shown.includes(point)) continue;
    let nearest = /** @type {ScoredPoint} */ (shown[0]);
    for (const other of shown.slice(1)) {
      if (distance(point, other) < distance(point, nearest)) nearest = other;
    }
    foldedUnder.set(point.id, nearest.id);
  }
  return { shown: shown.map(({ id }) => id), foldedUnder };
}

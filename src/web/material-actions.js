// The material panel's actions (decision 0066), with no DOM; the page passes the requests in.
// A section names a sketch (0061), so an elite of the map is kept as a sketch through the
// session's sketch route before it is placed, and a steer's best point is kept the same way
// before it is swapped into the section it was steered from.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { EliteRow } from "./material-panel.js" */
import { sessionPath } from "./api.js";
import { NO_OPEN_SESSION } from "./brief-jobs.js";
import { addSection } from "./timeline-edits.js";

/** How far along a direction's scale one steer of a section aims, from where it sits. */
export const STEER_STEP = 0.25;

/** The two ways along a direction: toward its far end, or back toward its near end. */
export const TOWARD = Object.freeze({ far: 1, near: -1 });

/** @typedef {(typeof TOWARD)[keyof typeof TOWARD]} Toward */

/**
 * A sketch as the track route lists it, as far as these actions read it.
 * @typedef {{ id: number, candidateId: number, duration: number }} ActionSketch
 */

/**
 * Sends a sketch to the sketch route and returns the stored row.
 * @typedef {(path: string, body: Record<string, unknown>) => Promise<ActionSketch>} KeepSketch
 */

/**
 * The body that keeps `candidateId` as a sketch, heard as `renderId`. The notes are the owner's
 * to write, on the brief page, as the map's Keep as sketch leaves them.
 * @param {number} candidateId
 * @param {number} renderId
 */
const sketchBody = (candidateId, renderId) => ({ candidateId, renderId, notes: "", tags: [] });

/**
 * Places an elite after section `after`, or first when null: the sketch already kept of its
 * candidate, or a new one kept in the open session, after which the sketches are read again so
 * the new one's duration is known.
 * @param {Arrangement} arrangement
 * @param {number | null} after
 * @param {EliteRow} elite
 * @param {object} io
 * @param {readonly ActionSketch[]} io.sketches the brief's, as last read
 * @param {number | null} io.sessionId the open session a new sketch is kept in
 * @param {KeepSketch} io.keep
 * @param {() => Promise<ActionSketch[]>} io.reload reads the brief's sketches again
 * @returns {Promise<{ arrangement: Arrangement, index: number, sketch: ActionSketch, made: boolean }>}
 */
export async function placeElite(
  arrangement,
  after,
  { cell },
  { sketches, sessionId, keep, reload },
) {
  let sketch = sketches.find(({ candidateId }) => candidateId === cell.candidateId);
  const made = sketch === undefined;
  if (sketch === undefined) {
    if (sessionId === null) throw new Error(NO_OPEN_SESSION);
    const kept = await keep(
      `${sessionPath(sessionId)}/sketches`,
      sketchBody(cell.candidateId, cell.renderId),
    );
    sketch = (await reload()).find(({ id }) => id === kept.id);
    if (sketch === undefined) throw new Error(`sketch ${kept.id} was kept but isn't listed`);
  }
  return { ...addSection(arrangement, sketch, after), sketch, made };
}

/**
 * The setting a steer aims at: a step from the section's position toward the end chosen, held
 * in 0 to 1, or that end itself when the position isn't known.
 * @param {number | null} position on the vibe's scale
 * @param {Toward} toward
 */
export function steerSetting(position, toward) {
  if (position === null) return toward > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, position + toward * STEER_STEP));
}

/**
 * The steer route's body for a section's sketch along one direction.
 * @param {number} candidateId the section's sketch's
 * @param {{ directionId: number, position: number | null }} placed the sketch's position on it
 * @param {Toward} toward
 */
export const steerBody = (candidateId, { directionId, position }, toward) => ({
  candidateId,
  directions: [{ id: directionId, setting: steerSetting(position, toward) }],
});

/**
 * Keeps a finished steer's best point as a sketch, by its excerpt.
 * @param {{ best: { candidateId: number, score: number } | null }} result the steer job's
 * @param {object} io
 * @param {number} io.sessionId the session the steer ran in
 * @param {() => Promise<{ id: number, excerpt: { renderId: number } | null }[]>} io.candidates
 *   reads the session's candidates
 * @param {KeepSketch} io.keep
 * @returns {Promise<ActionSketch>}
 */
export async function keepSteered({ best }, { sessionId, candidates, keep }) {
  if (best === null) {
    throw new Error("The steer kept no point that could be scored, so nothing was swapped in.");
  }
  const found = (await candidates()).find(({ id }) => id === best.candidateId);
  if (!found?.excerpt) {
    throw new Error(
      `The steer's best point, candidate ${best.candidateId} has no excerpt to keep.`,
    );
  }
  return keep(
    `${sessionPath(sessionId)}/sketches`,
    sketchBody(best.candidateId, found.excerpt.renderId),
  );
}

/**
 * The arrangement with section `index` naming `sketchId`, its window unchanged: a steer moves
 * only macros, so the steered genome keeps its sketch's duration.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {number} sketchId
 * @returns {Arrangement}
 */
export const swapSketch = (arrangement, index, sketchId) => ({
  ...arrangement,
  sections: arrangement.sections.map((section, i) =>
    i === index ? { ...section, sketchId } : section,
  ),
});

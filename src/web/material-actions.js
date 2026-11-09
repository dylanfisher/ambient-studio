// The material panel's actions (decision 0066), with no DOM; the page passes the requests in.
// A section names a sketch (0061), so an elite of the map is kept as a sketch through the
// session's sketch route before it is placed, and a steer's best point is kept the same way
// before it is swapped into the section it was steered from.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { EliteRow } from "./material-panel.js" */
import { sessionPath } from "./api.js";
import { NO_OPEN_SESSION } from "./brief-jobs.js";
import { addSection } from "./timeline-edits.js";

/** How far along a direction's scale one steer of a section aims, from where it sits. */
export const STEER_STEP = 0.25;

/** What a steer's confirm and status line say about leaving the page while it runs. */
export const STEER_LEAVE =
  "If this page is closed or reloaded before the steer ends, the job still finishes, but its best point isn't kept or swapped in: keep it from the session page by hand.";

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

/** What `steerSwap` does with a steer's sketch. */
export const SWAP = Object.freeze(
  /** @type {const} */ ({ save: "save", edit: "edit", skip: "skip" }),
);

/**
 * What to do with a finished steer's sketch: save it in its section's place, put it on the
 * unsaved timeline, or leave it kept and say why. The section is the one steered from, found at
 * its place or by its window, whatever its text says now. Saving the timeline during the run
 * keeps the same line of versions; opening another version by hand doesn't, so a section there
 * that happens to match is left alone.
 * @param {object} state
 * @param {Arrangement} state.arrangement the timeline now
 * @param {Section} state.from the section as it was when the steer started
 * @param {number} state.at its place then
 * @param {number} state.openedThen the page's count of versions opened by hand, at the start
 * @param {number} state.openedNow that count now
 * @param {boolean} state.unsaved whether the timeline has changes not saved
 * @returns {{ kind: typeof SWAP.save | typeof SWAP.edit, index: number } | { kind: typeof SWAP.skip, reason: string }}
 */
export function steerSwap({ arrangement, from, at, openedThen, openedNow, unsaved }) {
  if (openedNow !== openedThen) {
    return { kind: SWAP.skip, reason: "another version was opened while it ran" };
  }
  // The window, not the text: words written on the section during the run don't stop the swap.
  const same = (/** @type {Section | undefined} */ section) =>
    section !== undefined &&
    section.sketchId === from.sketchId &&
    section.offset === from.offset &&
    section.seconds === from.seconds;
  const index = same(arrangement.sections[at]) ? at : arrangement.sections.findIndex(same);
  if (index === -1) {
    return { kind: SWAP.skip, reason: "its section has changed or been removed since" };
  }
  return { kind: unsaved ? SWAP.edit : SWAP.save, index };
}

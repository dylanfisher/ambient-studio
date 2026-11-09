// Developing a section on the timeline (decision 0079), with no DOM: the confirm before the
// model is asked, what the chosen section says once developed, and where a finished development
// goes, by `steerSwap`'s rules for a timeline that changed during the run (0066).
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
import { DEVELOP_LEAST } from "../domain/develop-prompt.js";
import { clockTime } from "./excerpt-player.js";
import { formatTime } from "./format-time.js";
import { SWAP, steerSwap } from "./material-actions.js";
import { REQUESTS, requestsTimeText } from "./proposal-text.js";
import { setDevelopment } from "./timeline-edits.js";

/**
 * @param {number} index the section's, from 0
 * @param {number} seconds its seconds
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 * @returns {string} the confirm's question and its cost
 */
export function developCostText(index, seconds, estimate) {
  return (
    `Ask the model to develop section ${index + 1}? It reads your words for the section, the track's arc, the sketch with how it was made, and where the sections on either side meet it, and writes the section's own ${clockTime(seconds)}. ` +
    `That is ${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing. ` +
    `Nothing is rendered, and the sketch stays as it is: the development is saved as a new version of this track, with a way back to the plain sketch. ${requestsTimeText(estimate)}`
  );
}

/**
 * Why the chosen section can't be developed now, as the button's title, or null when it can.
 * @param {Section} section
 * @param {boolean} unsaved whether the timeline has changes not saved
 */
export function developRefusal({ seconds }, unsaved) {
  if (unsaved) return "Turned off until the timeline is saved: only a saved version is developed.";
  if (seconds < DEVELOP_LEAST) {
    return `Turned off: a section must play at least ${clockTime(DEVELOP_LEAST)} to be developed, and this one plays ${clockTime(seconds)}.`;
  }
  return null;
}

/**
 * What the chosen section says about the development it plays.
 * @param {{ id: number, text: string, createdAt: number } | undefined} development
 * @returns {string}
 */
export function developedText(development) {
  if (!development) return "It plays its sketch as it is.";
  const words = development.text === "" ? "with no words" : `from your words “${development.text}”`;
  return `It plays development ${development.id} of its sketch, written ${formatTime(development.createdAt)} ${words}.`;
}

/**
 * What to do with a finished development: save it in its section's place, put it on the unsaved
 * timeline, or leave it and say why. The section is the one developed, found by `steerSwap`; it
 * then plays the development from its start.
 * @param {Parameters<typeof steerSwap>[0]} state
 * @param {number} developmentId
 * @returns {{ kind: typeof SWAP.save | typeof SWAP.edit, index: number, arrangement: Arrangement }
 *   | { kind: typeof SWAP.skip, reason: string }}
 */
export function developSwap(state, developmentId) {
  const swap = steerSwap(state);
  if (swap.kind === SWAP.skip) return swap;
  return {
    ...swap,
    arrangement: setDevelopment(state.arrangement, swap.index, developmentId, 0),
  };
}

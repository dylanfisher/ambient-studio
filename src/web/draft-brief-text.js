// What the brief page says about drafting a brief from the owner's words (decision 0074): the
// confirm before it starts, and the status line once the form is filled; and what the dashboard
// says about a brief suggested from the owner's (0093). No DOM here, so the wording is tested.
import { REQUESTS, requestsTimeText } from "./proposal-text.js";

/**
 * @param {boolean} rework whether the form holds a brief to rework
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 * @returns {string} the confirm's question and its cost
 */
export function draftCostText(rework, estimate) {
  const what = rework
    ? "Ask the model to rework the brief from your words? It reads the form as it is now, saved or not, and writes the whole brief again."
    : "Ask the model to fill in the brief from your words?";
  return (
    `${what} That is ${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing. ` +
    `The answer fills the form, and nothing is saved until you press Save. ${requestsTimeText(estimate)}`
  );
}

/**
 * @param {boolean} repaired whether the answer took the repair round
 * @returns {string} the status line once the form holds the model's draft
 */
export const draftFilledText = (repaired) =>
  `The model filled in the form${repaired ? ", after one fix" : ""}. Nothing is saved yet: check it, edit it, and press Save to keep it.`;

/**
 * The dashboard's confirm before the model suggests a brief from the owner's (decision 0093).
 * @param {number} briefs how many briefs there are for it to read
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 */
export const suggestCostText = (briefs, estimate) =>
  `Ask the model to suggest a new brief? It reads your ${briefs} brief${briefs === 1 ? "" : "s"}, newest edit first, as many as fit, and your words. ` +
  `That is ${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing. ` +
  `Nothing is saved until you press Approve. ${requestsTimeText(estimate)}`;

/**
 * @param {{ repaired: boolean, briefsRead: number, briefsTotal: number }} result the job's
 * @returns {string} the status line once the suggestion is shown
 */
export function suggestedText({ repaired, briefsRead, briefsTotal }) {
  const read =
    briefsRead === briefsTotal
      ? `all ${briefsTotal} of your briefs`
      : `your newest ${briefsRead} of ${briefsTotal} briefs, all that fit`;
  return `The model suggested a brief from ${read}${repaired ? ", after one fix" : ""}. Nothing is saved yet: press Approve to add it as a brief.`;
}

// What the brief page says about drafting a brief from the owner's words (decision 0074): the
// confirm before it starts, and the status line once the form is filled. No DOM here, so the
// wording is tested.
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

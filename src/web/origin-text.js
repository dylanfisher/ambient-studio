// How a candidate was made, in words, for its card and its lineage node (decision 0039): its
// operator and parent, an explore's direction, and why a rejected one was rejected. A nudge
// child has no intent and its rejected draws are no model answer, so neither reads as one. No
// DOM: the page sets these with `textContent`, so a direction is never read as HTML.
import { OPERATOR } from "../domain/operator.js";
import { REJECT_REASON } from "../domain/reject-reason.js";

/**
 * The parts of a candidate this reads, as the candidates and lineage routes give them.
 * @typedef {object} Origin
 * @property {string | null} operator
 * @property {any} operatorParams
 * @property {readonly unknown[]} parentIds
 * @property {string | null} intent
 * @property {string | null} rejectReason
 */

/** What each reject reason says about the answer or draw it names. */
const REJECTED = Object.freeze({
  [REJECT_REASON.truncated]: "that was cut off at the length limit",
  [REJECT_REASON.noJson]: "with no JSON in it",
  [REJECT_REASON.invalidJson]: "whose JSON didn't parse",
  [REJECT_REASON.severalObjects]: "with more than one JSON object in it",
  [REJECT_REASON.schemaErrors]: "that broke the genome's format",
  [REJECT_REASON.lintErrors]: "that broke the brief's rules",
  [REJECT_REASON.requestFailed]: "that never came, since the request to the model failed",
  [REJECT_REASON.repeated]: "that landed on a genome already made",
});

/**
 * @param {Origin} candidate
 * @param {(id: number) => string} nameOf how the page names another candidate, as `candidate 3`
 * @returns {string}
 */
export function originText({ operator, operatorParams, parentIds }, nameOf) {
  if (operator === null) return "A first try from the model.";
  const parent = nameOf(/** @type {number} */ (parentIds[0]));
  if (operator === OPERATOR.revise) {
    return `The model's revision of ${parent}, after its excerpt missed a range or a check.`;
  }
  if (operator === OPERATOR.nudge) {
    return `A ${operatorParams.stepSize} nudge of ${parent}: its numbers moved, with no model request.`;
  }
  if (operator === OPERATOR.explore) {
    const { direction, baseTrimmed } = operatorParams;
    const toward = typeof direction === "string" ? `, toward “${direction}”` : "";
    const trimmed = baseTrimmed
      ? " The base didn't fit in the model's context, so the model never read it: this is a plain first try."
      : "";
    return `The model's variation of ${parent}${toward}.${trimmed}`;
  }
  throw new Error(`the page doesn't know the operator ${operator}`);
}

/** Each operator as a node's badge reads; a first try's is under null. */
const OPERATOR_WORDS = Object.freeze({
  [OPERATOR.revise]: "revised",
  [OPERATOR.nudge]: "nudged",
  [OPERATOR.explore]: "variation",
});

/**
 * @param {string | null} operator
 * @returns {string} a word or two for a badge
 */
export function operatorLabel(operator) {
  if (operator === null) return "first try";
  const words = OPERATOR_WORDS[/** @type {keyof typeof OPERATOR_WORDS} */ (operator)];
  if (words === undefined) throw new Error(`the page doesn't know the operator ${operator}`);
  return words;
}

/**
 * The card's intent line: the model's intent, or why there is none.
 * @param {Origin} candidate
 * @returns {string}
 */
export const intentText = ({ intent, operator }) =>
  intent ??
  (operator === OPERATOR.nudge
    ? "A nudge has no intent of its own: it is its base with some numbers moved."
    : "The model gave no intent.");

/**
 * Why a rejected candidate was rejected, as a phrase: a nudge's draw or a model's answer.
 * @param {Origin} candidate
 * @returns {string}
 */
export function rejectText({ operator, rejectReason }) {
  const why = REJECTED[/** @type {keyof typeof REJECTED} */ (rejectReason)];
  if (why === undefined) throw new Error(`the page doesn't know the reject reason ${rejectReason}`);
  return operator === OPERATOR.nudge
    ? `a nudge draw ${why}, so it was drawn again`
    : `a model answer ${why}`;
}

// Each operator in a word or two (decision 0039): a lineage node's badge, and each step of a
// sketch's lineage as the model reads it (0078). A first try from a plain request has none.
import { OPERATOR } from "./operator.js";

/** Each operator as a node's badge reads; a first try's is under null. */
const OPERATOR_WORDS = Object.freeze({
  [OPERATOR.revise]: "revised",
  [OPERATOR.nudge]: "nudged",
  [OPERATOR.explore]: "variation",
  [OPERATOR.optimize]: "searched",
  [OPERATOR.optimizeEar]: "searched by ear",
  [OPERATOR.steer]: "steered",
  [OPERATOR.breed]: "bred",
  [OPERATOR.elite]: "map fill",
});

/**
 * @param {string | null} operator
 * @returns {string} a word or two for a badge
 */
export function operatorLabel(operator) {
  if (operator === null) return "first try";
  const words = OPERATOR_WORDS[/** @type {keyof typeof OPERATOR_WORDS} */ (operator)];
  if (words === undefined) throw new Error(`there are no words for the operator ${operator}`);
  return words;
}

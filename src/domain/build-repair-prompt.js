// The repair round's prompt: the first prompt, the model's answer, and the validator's and
// linter's errors quoted back (decision 0024), as a follow-up turn (0036).
/** @import { ChatMessage } from "./prompt-tokens.js" */
import { ANSWER_FORMAT } from "./build-prompt.js";
import { followUp } from "./follow-up.js";

/**
 * An error to quote: a validator error has no rule, a lint finding names its rule.
 * @typedef {{ path: string, message: string, rule?: string }} QuotedError
 */

/**
 * Each error as `- path (rule): message`, the way the repair and the revision quote them.
 * @param {readonly QuotedError[]} errors
 * @returns {string[]}
 */
export const quotedErrors = (errors) =>
  errors.map(
    ({ path, rule, message }) => `- ${path}${rule === undefined ? "" : ` (${rule})`}: ${message}`,
  );

/**
 * @param {{ messages: ChatMessage[], answer: unknown }} previous the prompt sent and the answer
 *   parsed from its response
 * @param {QuotedError[]} errors
 * @returns {ChatMessage[]}
 */
export function buildRepairPrompt({ messages, answer }, errors) {
  if (errors.length === 0) throw new Error("a repair prompt needs at least one error to quote");
  const ask = [
    "Your answer was rejected for these errors. Paths start at the genome.",
    ...quotedErrors(errors),
    `Fix every error and answer again with the whole corrected object, and nothing else: ${ANSWER_FORMAT}`,
  ].join("\n");
  return followUp(messages, answer, ask);
}

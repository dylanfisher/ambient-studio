// The repair round's prompt: the first prompt, the model's answer, and the validator's and
// linter's errors quoted back (decision 0024).
/** @import { ChatMessage } from "./prompt-tokens.js" */
import { ANSWER_FORMAT } from "./build-prompt.js";
import { ROLE } from "./prompt-tokens.js";

/**
 * An error to quote: a validator error has no rule, a lint finding names its rule.
 * @typedef {{ path: string, message: string, rule?: string }} QuotedError
 */

/**
 * @param {{ messages: ChatMessage[], answer: unknown }} previous the prompt sent and the answer
 *   parsed from its response; the answer is quoted as compact JSON, without prose or thinking
 * @param {QuotedError[]} errors
 * @returns {ChatMessage[]}
 */
export function buildRepairPrompt({ messages, answer }, errors) {
  if (errors.length === 0) throw new Error("a repair prompt needs at least one error to quote");
  const lines = errors.map(
    ({ path, rule, message }) => `- ${path}${rule === undefined ? "" : ` (${rule})`}: ${message}`,
  );
  const ask = [
    "Your answer was rejected for these errors. Paths start at the genome.",
    ...lines,
    `Fix every error and answer again with the whole corrected object, and nothing else: ${ANSWER_FORMAT}`,
  ].join("\n");
  return [
    ...messages,
    { role: ROLE.assistant, content: JSON.stringify(answer) },
    { role: ROLE.user, content: ask },
  ];
}

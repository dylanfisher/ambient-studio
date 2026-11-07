// One more exchange on a prompt already sent (decision 0036): the model's answer as an assistant
// turn, then one user turn. The repair round and the revision both build on it, and neither
// trims the earlier turns, so they stay byte for byte what was sent and omlx's prefix cache can
// reuse them.
/** @import { ChatMessage } from "./prompt-tokens.js" */
import { ROLE } from "./prompt-tokens.js";

/**
 * @param {readonly ChatMessage[]} messages the prompt as it was sent
 * @param {unknown} answer the parsed answer, quoted as compact JSON, without prose or thinking,
 *   so it stays short
 * @param {string} ask
 * @returns {ChatMessage[]}
 */
export function followUp(messages, answer, ask) {
  return [
    ...messages,
    { role: ROLE.assistant, content: JSON.stringify(answer) },
    { role: ROLE.user, content: ask },
  ];
}

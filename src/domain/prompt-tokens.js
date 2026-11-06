// The context budget's token estimate (decision 0022). The prompt builder trims to it and the
// omlx queue refuses a prompt over it, so both read this one estimate.

/** Who a chat message is from. */
export const ROLE = Object.freeze(
  /** @type {const} */ ({ system: "system", user: "user", assistant: "assistant" }),
);

/** @typedef {{ role: (typeof ROLE)[keyof typeof ROLE], content: string }} ChatMessage */

/** The context budget's estimate of characters per token, for prompts and answers alike. */
export const CHARS_PER_TOKEN = 3.5;

/**
 * Tokens `text` is estimated to take at `CHARS_PER_TOKEN`, rounded up.
 * @param {string} text
 * @returns {number}
 */
export const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * The text the budget counts: every message's content, joined.
 * @param {ChatMessage[]} messages
 * @returns {string}
 */
export const promptText = (messages) => messages.map((message) => message.content).join("");

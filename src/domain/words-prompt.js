// The words operator's prompt (decision 0084): the owner's words, the fields of one set, each
// with what it does, the values it takes and its value now, and short context: the brief and,
// when there is one, a reading of what is being changed. The answer is
// `{"changes": {field: value}, "said": "…"}`; the repair round quotes the findings back as a
// follow-up turn (0024, 0036).
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { ChatMessage } from "./prompt-tokens.js" */
/** @import { WordsContext, WordsSet } from "./words-sets.js" */
import { valueText } from "../engine/descriptor.js";
import { show } from "../engine/validation-error.js";
import { quotedErrors } from "./build-repair-prompt.js";
import { followUp } from "./follow-up.js";
import { estimateTokens, promptText, ROLE } from "./prompt-tokens.js";
import { quoted } from "./references-text.js";

/** The answer's two keys. */
export const WORDS_KEY = Object.freeze({ changes: "changes", said: "said" });

/** The most characters of words the owner may send, as many as a note for the model. */
export const WORDS_CHARS = 300;

/** The JSON schema sent as the answer's format when the config asks for one (0022). */
export const WORDS_RESPONSE_FORMAT = Object.freeze({
  name: "words_answer",
  schema: {
    type: "object",
    properties: {
      [WORDS_KEY.changes]: { type: "object" },
      [WORDS_KEY.said]: { type: "string" },
    },
    required: Object.values(WORDS_KEY),
    additionalProperties: false,
  },
});

/**
 * One field the words may change: its name in the answer, its descriptor, and its value now.
 * @typedef {{ name: string, descriptor: Descriptor, current: unknown }} WordsField
 */

/**
 * @typedef {object} WordsAsk
 * @property {string} words the owner's
 * @property {string} subject what the fields set, completing "The fields set …"
 * @property {readonly WordsField[]} fields
 * @property {string} brief the brief's description
 * @property {readonly string[]} reading what is being changed, as lines; none when the set has
 *   no reading
 */

const FORMAT = `{${quoted(WORDS_KEY.changes)}: {"<field>": <value>, …}, ${quoted(WORDS_KEY.said)}: "<one plain sentence saying what you changed>"}`;

const SYSTEM = [
  "You turn a listener's plain words into settings for a generative ambient music engine. You are given some fields, each with what it does, the values it takes and its value now.",
  "Change only the fields the words speak of, by as much as they say, and leave every other field out of the answer.",
  "Values are written low..high for a number in that range, with its unit, int meaning a whole number; and a|b|c for one of those choices, given as a string.",
  `Answer with one JSON object and nothing else: ${FORMAT}, naming each field exactly as listed.`,
].join("\n");

/** @param {WordsField} field */
const fieldLine = ({ name, descriptor, current }) =>
  `- ${name}: ${descriptor.description}; ${valueText(descriptor)}; now ${show(current)}`;

/**
 * The prompt for one words request. Throws when it is over `budgetTokens`.
 * @param {WordsAsk} ask
 * @param {number} budgetTokens the most the prompt may take
 * @returns {ChatMessage[]}
 */
export function buildWordsPrompt({ words, subject, fields, brief, reading }, budgetTokens) {
  const user = [
    `The fields set ${subject}.`,
    `The brief: ${brief}`,
    ...(reading.length > 0 ? ["What is being changed, as it is now:", ...reading] : []),
    "The fields, each with what it does, its values and its value now:",
    ...fields.map(fieldLine),
    `The listener's words, as a JSON string: ${quoted(words)}`,
  ];
  const built = [
    { role: ROLE.system, content: SYSTEM },
    { role: ROLE.user, content: user.join("\n") },
  ];
  const tokens = estimateTokens(promptText(built));
  if (tokens > budgetTokens) {
    throw new Error(
      `the words' prompt is about ${tokens} tokens, over its ${budgetTokens}-token budget; shorten the brief or your words`,
    );
  }
  return built;
}

/**
 * The prompt for one set's fields, built from `context` and narrowed by the set (0085) until it
 * fits `budgetTokens`. Throws when even the narrowest is over it.
 * @param {Omit<WordsAsk, "subject" | "fields"> & { set: WordsSet, context: WordsContext,
 *   current: Readonly<Record<string, unknown>> }} ask `current` holds a value for every field of
 *   the widest set, as the route checked it
 * @param {number} budgetTokens
 * @returns {{ messages: ChatMessage[], fields: WordsField[] }}
 */
export function fitWordsPrompt({ set, context, current, ...rest }, budgetTokens) {
  let at = context;
  for (;;) {
    const reading = set.reading ? set.reading(/** @type {any} */ (at)) : rest.reading;
    const fields = Object.entries(set.fields(at)).map(([name, descriptor]) => ({
      name,
      descriptor,
      current: current[name],
    }));
    try {
      return {
        messages: buildWordsPrompt(
          { ...rest, reading, subject: set.subject, fields },
          budgetTokens,
        ),
        fields,
      };
    } catch (error) {
      const next = set.narrower?.(at) ?? null;
      if (next === null) throw error;
      at = next;
    }
  }
}

/**
 * The repair as a follow-up turn on the prompt sent, quoting every finding.
 * @param {{ messages: ChatMessage[], answer: unknown }} previous
 * @param {readonly QuotedError[]} errors
 * @returns {ChatMessage[]}
 */
export function buildWordsRepair({ messages, answer }, errors) {
  if (errors.length === 0) throw new Error("a words repair quotes at least one finding");
  const ask = [
    "Your answer was rejected for these errors. Paths start at the answer.",
    ...quotedErrors(errors),
    `Fix every error and answer again with the whole corrected object, and nothing else: ${FORMAT}`,
  ].join("\n");
  return followUp(messages, answer, ask);
}

// The shift prompt (decision 0075): the owner's words for how a search by ear should lean, read
// by the model as a shift from -1 to 1 on each path the search moves. A system message with the
// answer's form, and a user message with the brief, each path and where the best so far sits on
// it, and the words. The answer only sets the page's sliders; the owner sends them.
/** @import { ChatMessage } from "./prompt-tokens.js" */
import { checkSteering, EAR_VARIATION } from "./ear-settings.js";
import { extractObject } from "./extract-genome.js";
import { ROLE } from "./prompt-tokens.js";

/** The answer's one key. */
const SHIFT_KEY = "shift";

/** The most characters of words the owner may send, as many as a note for the model. */
export const SHIFT_WORDS_CHARS = 300;

/** The JSON schema sent as the answer's format when the config asks for one. */
export const SHIFT_RESPONSE_FORMAT = Object.freeze({
  name: "shift_answer",
  schema: {
    type: "object",
    properties: { [SHIFT_KEY]: { type: "object", additionalProperties: { type: "number" } } },
    required: [SHIFT_KEY],
    additionalProperties: false,
  },
});

const SYSTEM = [
  "You steer a search through generative ambient music. Each new variation the search plays",
  "is drawn near the best so far, and leans toward a shift: for each control, a number from -1",
  "(less of it) to 1 (more of it), 0 or left out for no lean. Read the listener's words as that",
  "shift. Lean only the controls the words speak of, by how strongly they say it: 0.25 a",
  "little, 0.5 clearly, 1 as far as it goes.",
  `Answer with one JSON object and nothing else: {"${SHIFT_KEY}": {"<control>": <number>, ...}},`,
  "naming each control exactly as listed.",
].join(" ");

/**
 * @param {{ brief: string, paths: readonly string[], positions: readonly number[],
 *   words: string }} ask each path's position from 0 to 1 where the best so far sits
 * @returns {ChatMessage[]}
 */
export function buildShiftPrompt({ brief, paths, positions, words }) {
  const controls = paths.map(
    (path, i) => `- ${path}: now ${/** @type {number} */ (positions[i]).toFixed(2)} of 0 to 1`,
  );
  return [
    { role: ROLE.system, content: SYSTEM },
    {
      role: ROLE.user,
      content: [
        `The brief: ${brief}`,
        "The controls, and where the best so far sits on each:",
        ...controls,
        `The listener's words: ${words}`,
      ].join("\n"),
    },
  ];
}

/**
 * The shift an answer holds, checked as the steering route checks the page's, or why it can't
 * be read.
 * @param {{ text: string, finishReason: string }} completion
 * @param {readonly string[]} paths
 * @returns {{ ok: true, shift: Record<string, number> } | { ok: false, error: string }}
 */
export function readShift({ text, finishReason }, paths) {
  if (finishReason === "length") return { ok: false, error: "the answer was cut off" };
  const found = extractObject(text);
  if (!found.ok) return { ok: false, error: found.message };
  const extra = Object.keys(found.answer).filter((key) => key !== SHIFT_KEY);
  if (extra.length > 0) return { ok: false, error: `the answer has ${extra.join(", ")}` };
  // Any variation checks the shift alike; the page keeps its own.
  const [variation] = Object.keys(EAR_VARIATION);
  const checked = checkSteering(variation, found.answer[SHIFT_KEY], paths);
  return checked.ok ? { ok: true, shift: checked.steering.shift } : checked;
}

// The generation prompt: a system message with the answer format and the genome schema, and a
// user message with the vibe, its constraints and feature ranges, the locks, the owner's notes
// and rated examples, under the context budget (decisions 0024 and 0034). Examples go first
// when it doesn't fit.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { ChatMessage } from "./prompt-tokens.js" */
/** @import { RecordingListing } from "./recordings-text.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
/** @import { Lock } from "./validate-lock.js" */
import { canonicalGenome } from "../engine/canonical-genome.js";
import { schemaText } from "../engine/schema-text.js";
import { constraintsText } from "./constraints-text.js";
import { ANSWER_KEY } from "./extract-genome.js";
import { estimateTokens, promptText, ROLE } from "./prompt-tokens.js";
import { recordingsText } from "./recordings-text.js";
import { targetsText } from "./targets-text.js";

/**
 * What the prompt reads from a vibe revision.
 * @typedef {object} PromptRevision
 * @property {string} name
 * @property {string} brief
 * @property {Constraints} constraints a validated set
 * @property {FeatureRanges} ranges validated, as `validateTargets` returns them
 */

/**
 * A genome the owner rated in this vibe.
 * @typedef {object} PromptExample
 * @property {number} id the genome's row id, logged with the generation
 * @property {boolean} liked
 * @property {unknown} genome a valid genome
 */

/**
 * @typedef {object} PromptParts
 * @property {string[]} notes the owner's notes, oldest first
 * @property {readonly Lock[]} locks
 * @property {PromptExample[]} examples most wanted first; trimmed from the end
 * @property {number} budgetTokens the queue's `contextBudgetTokens`
 * @property {readonly RecordingListing[]} recordings the recordings folder's index, empty when
 *   the config sets no folder; the system message lists the playable ones
 */

/** @typedef {{ messages: ChatMessage[], exampleIds: number[] }} Prompt */

/** The answer format, written the way the model should write it. */
export const ANSWER_FORMAT = `{"${ANSWER_KEY.intent}": "<one line: what this genome is going for>", "${ANSWER_KEY.genome}": {<the genome>}}`;

const SYSTEM = [
  "You design genomes for a generative ambient music engine. The owner describes a vibe; you write one new genome for it.",
  `Answer with one JSON object and nothing else: ${ANSWER_FORMAT}`,
  "",
  schemaText(),
].join("\n");

/**
 * @param {string} heading
 * @param {string[]} lines
 * @returns {string[]} the heading and lines as one paragraph, or nothing when there are no lines
 */
const section = (heading, lines) => (lines.length === 0 ? [] : [[heading, ...lines].join("\n")]);

/**
 * @param {PromptRevision} revision
 * @param {Omit<PromptParts, "budgetTokens">} parts
 * @returns {ChatMessage[]}
 */
function messages(revision, { notes, locks, examples, recordings }) {
  const offered = recordingsText(recordings);
  const targets = targetsText(revision.ranges);
  const user = [
    `Vibe: ${revision.name}\n${revision.brief}`,
    constraintsText(revision.constraints),
    ...(targets === "" ? [] : [targets]),
    ...section(
      "Locked by the owner; keep these values exactly:",
      // A voice's parameter names the type too: the lock holds only while the voice keeps it.
      locks.map(
        ({ path, value, voiceType }) =>
          `${path} = ${JSON.stringify(value)}${voiceType === undefined ? "" : ` (a ${voiceType} voice)`}`,
      ),
    ),
    ...section(
      "The owner's notes, oldest first:",
      notes.map((note) => `- ${note}`),
    ),
    ...section(
      "Genomes the owner rated in this vibe:",
      examples.map(
        ({ liked, genome }) => `${liked ? "Liked" : "Disliked"}: ${canonicalGenome(genome)}`,
      ),
    ),
    "Write one new genome for this vibe.",
  ].join("\n\n");
  return [
    { role: ROLE.system, content: offered === "" ? SYSTEM : `${SYSTEM}\n\n${offered}` },
    { role: ROLE.user, content: user },
  ];
}

/**
 * The prompt for one generation request. Throws when it doesn't fit the budget even with every
 * example trimmed.
 * @param {PromptRevision} revision
 * @param {PromptParts} parts
 * @returns {Prompt}
 */
export function buildPrompt(revision, { budgetTokens, examples, ...rest }) {
  const tokens = (/** @type {PromptExample[]} */ kept) =>
    estimateTokens(promptText(messages(revision, { ...rest, examples: kept })));
  const bare = tokens([]);
  if (bare > budgetTokens) {
    throw new Error(
      `the prompt is about ${bare} tokens with no examples, over the ${budgetTokens}-token budget; shorten the vibe's brief or notes`,
    );
  }
  let kept = examples;
  while (kept.length > 0 && tokens(kept) > budgetTokens) kept = kept.slice(0, -1);
  return {
    messages: messages(revision, { ...rest, examples: kept }),
    exampleIds: kept.map((e) => e.id),
  };
}

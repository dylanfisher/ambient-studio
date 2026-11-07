// The generation prompt: a system message with the answer format and the genome schema, and a
// user message with the vibe, its constraints and feature ranges, the locks, the owner's notes
// and rated examples, and for an explore the base to vary, under the context budget (decisions
// 0024, 0034 and 0038). Examples go first when it doesn't fit, then the base.
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
 * The candidate an explore varies (decision 0038).
 * @typedef {object} PromptBase
 * @property {unknown} genome a valid genome, with the vibe's locks applied
 * @property {string | null} direction the owner's line as written, or null for none
 */

/**
 * @typedef {object} PromptParts
 * @property {string[]} notes the owner's notes, oldest first
 * @property {readonly Lock[]} locks
 * @property {PromptExample[]} examples most wanted first; trimmed from the end
 * @property {number} budgetTokens the queue's `contextBudgetTokens`
 * @property {readonly RecordingListing[]} recordings the recordings folder's index, empty when
 *   the config sets no folder; the system message lists the playable ones
 * @property {PromptBase | null} [base] an explore's base; a prompt without one asks for a new
 *   genome
 */

/**
 * `baseTrimmed` is true when a base was given and left out to fit the budget.
 * @typedef {{ messages: ChatMessage[], exampleIds: number[], baseTrimmed: boolean }} Prompt
 */

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
 * The locks as one paragraph, one `path = value` line each, or nothing when there are none. The
 * revision's ask restates them in the same words.
 * @param {readonly Lock[]} locks
 * @returns {string[]}
 */
export const locksText = (locks) =>
  section(
    "Locked by the owner; keep these values exactly:",
    // A voice's parameter names the type too: the lock holds only while the voice keeps it.
    locks.map(
      ({ path, value, voiceType }) =>
        `${path} = ${JSON.stringify(value)}${voiceType === undefined ? "" : ` (a ${voiceType} voice)`}`,
    ),
  );

/**
 * The base section and the ask that goes with it, or the first try's ask alone. The direction is
 * written as a JSON string, so its quotes and line breaks are escaped and it can't end the
 * section or start one of its own.
 * @param {PromptBase | null} base
 * @param {readonly Lock[]} locks
 * @returns {string[]}
 */
function baseAndAsk(base, locks) {
  if (base === null) return ["Write one new genome for this vibe."];
  const { genome, direction } = base;
  const heard =
    direction === null
      ? []
      : [
          `The owner's direction for this variation, as a JSON string: ${JSON.stringify(direction)}`,
        ];
  const keep = locks.length === 0 ? "" : ": keep the locked values exactly and change the rest";
  const follow = direction === null ? "" : " Follow the owner's direction.";
  return [
    ["The base genome to vary:", canonicalGenome(genome), ...heard].join("\n"),
    `Write one variation of the base genome for this vibe${keep}.${follow}`,
  ];
}

/**
 * @param {PromptRevision} revision
 * @param {Omit<PromptParts, "budgetTokens" | "base"> & { base: PromptBase | null }} parts
 * @returns {ChatMessage[]}
 */
function messages(revision, { notes, locks, examples, recordings, base }) {
  const offered = recordingsText(recordings);
  const targets = targetsText(revision.ranges);
  const user = [
    `Vibe: ${revision.name}\n${revision.brief}`,
    constraintsText(revision.constraints),
    ...(targets === "" ? [] : [targets]),
    ...locksText(locks),
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
    ...baseAndAsk(base, locks),
  ].join("\n\n");
  return [
    { role: ROLE.system, content: offered === "" ? SYSTEM : `${SYSTEM}\n\n${offered}` },
    { role: ROLE.user, content: user },
  ];
}

/**
 * The prompt for one generation request. Examples are trimmed from the end until it fits the
 * budget, then the base. Throws when it doesn't fit with both trimmed.
 * @param {PromptRevision} revision
 * @param {PromptParts} parts
 * @returns {Prompt}
 */
export function buildPrompt(revision, { budgetTokens, examples, base = null, ...rest }) {
  const tokens = (/** @type {PromptExample[]} */ kept, /** @type {PromptBase | null} */ keptBase) =>
    estimateTokens(promptText(messages(revision, { ...rest, examples: kept, base: keptBase })));
  const keptBase = base !== null && tokens([], base) > budgetTokens ? null : base;
  const bare = tokens([], keptBase);
  if (bare > budgetTokens) {
    const none = base === null ? "no examples" : "no examples and no base";
    throw new Error(
      `the prompt is about ${bare} tokens with ${none}, over the ${budgetTokens}-token budget; shorten the vibe's brief or notes`,
    );
  }
  let kept = examples;
  while (kept.length > 0 && tokens(kept, keptBase) > budgetTokens) kept = kept.slice(0, -1);
  return {
    messages: messages(revision, { ...rest, examples: kept, base: keptBase }),
    exampleIds: kept.map((e) => e.id),
    baseTrimmed: keptBase !== base,
  };
}

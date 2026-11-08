// The generation prompt: a system message with the answer format and the genome schema, and a
// user message with the vibe, its constraints and feature ranges, the reference regions attached
// to it, the locks, the owner's notes and rated examples, and for an explore the base to vary,
// or for breeding's crossover the two parents (0058), under the context budget (decisions 0024,
// 0034, 0038 and 0052). Examples go first when it doesn't fit, then the references, then the base,
// or parent B and then parent A.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { ChatMessage } from "./prompt-tokens.js" */
/** @import { RecordingListing } from "./recordings-text.js" */
/** @import { PromptReference } from "./references-text.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
/** @import { Lock } from "./validate-lock.js" */
import { conciseGenome } from "../engine/canonical-genome.js";
import { schemaText } from "../engine/schema-text.js";
import { constraintsText } from "./constraints-text.js";
import { ANSWER_KEY } from "./extract-genome.js";
import { estimateTokens, promptText, ROLE } from "./prompt-tokens.js";
import { recordingsText } from "./recordings-text.js";
import { referencesText } from "./references-text.js";
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
 * @property {readonly PromptReference[]} [references] the regions attached to the vibe, at most
 *   two; trimmed from the end after the examples
 * @property {PromptParents | null} [parents] breeding's two parents; a prompt holds them or a
 *   base, never both
 */

/**
 * The two candidates a crossover child takes parts of (decision 0058), each a valid genome with
 * the vibe's locks applied. B is trimmed before A.
 * @typedef {{ a: unknown, b: unknown }} PromptParents
 */

/** The parents' letters, in the order the prompt shows them; trimming drops them from the end. */
const PARENT_LETTERS = /** @type {const} */ (["A", "B"]);

/**
 * `referenceIds` are the references the prompt holds; `baseTrimmed` is true when a base was given
 * and left out to fit the budget, and `parentsTrimmed` names the parents left out, "B" first.
 * @typedef {{
 *   messages: ChatMessage[],
 *   exampleIds: number[],
 *   referenceIds: number[],
 *   baseTrimmed: boolean,
 *   parentsTrimmed: ("A" | "B")[],
 * }} Prompt
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
    ["The base genome to vary:", conciseGenome(genome), ...heard].join("\n"),
    `Write one variation of the base genome for this vibe${keep}.${follow}`,
  ];
}

/**
 * The two parents' sections and the ask for a child of both. A prompt with one parent left is an
 * explore's of parent A, with no direction.
 * @param {readonly unknown[]} parents A and B
 * @param {readonly Lock[]} locks
 * @returns {string[]}
 */
function parentsAndAsk(parents, locks) {
  const keep = locks.length === 0 ? "" : ": keep the locked values exactly";
  return [
    ...parents.map((genome, i) => `Parent ${PARENT_LETTERS[i]}:\n${conciseGenome(genome)}`),
    `Write one child of parents A and B for this vibe, taking parts from each, such as voices from one and settings from the other${keep}.`,
  ];
}

/**
 * The parts one prompt is written from, once trimmed.
 * @typedef {object} KeptParts
 * @property {string[]} notes
 * @property {readonly Lock[]} locks
 * @property {PromptExample[]} examples
 * @property {readonly RecordingListing[]} recordings
 * @property {PromptBase | null} base
 * @property {readonly PromptReference[]} references
 * @property {readonly unknown[]} parents the parents kept, A first
 */

/**
 * The parts trimmed to fit the budget.
 * @typedef {object} Trimmable
 * @property {PromptExample[]} examples
 * @property {readonly PromptReference[]} references
 * @property {PromptBase | null} base
 * @property {readonly unknown[]} parents
 */

/**
 * The asking end of the prompt: two parents, parent A alone as a base, or the base.
 * @param {PromptBase | null} base
 * @param {readonly unknown[]} parents
 * @param {readonly Lock[]} locks
 */
function ending(base, parents, locks) {
  if (parents.length === PARENT_LETTERS.length) return parentsAndAsk(parents, locks);
  if (parents.length === 1) return baseAndAsk({ genome: parents[0], direction: null }, locks);
  return baseAndAsk(base, locks);
}

/**
 * @param {PromptRevision} revision
 * @param {KeptParts} parts
 * @returns {ChatMessage[]}
 */
function messages(revision, { notes, locks, examples, recordings, base, references, parents }) {
  const offered = recordingsText(recordings);
  const targets = targetsText(revision.ranges);
  const attached = referencesText(references);
  const user = [
    `Vibe: ${revision.name}\n${revision.brief}`,
    constraintsText(revision.constraints),
    ...(targets === "" ? [] : [targets]),
    ...(attached === "" ? [] : [attached]),
    ...locksText(locks),
    ...section(
      "The owner's notes, oldest first:",
      notes.map((note) => `- ${note}`),
    ),
    ...section(
      "Genomes the owner rated in this vibe:",
      examples.map(
        ({ liked, genome }) => `${liked ? "Liked" : "Disliked"}: ${conciseGenome(genome)}`,
      ),
    ),
    ...ending(base, parents, locks),
  ].join("\n\n");
  return [
    { role: ROLE.system, content: offered === "" ? SYSTEM : `${SYSTEM}\n\n${offered}` },
    { role: ROLE.user, content: user },
  ];
}

/**
 * The prompt for one generation request. Examples are trimmed from the end until it fits the
 * budget, then references from the end, then the base, or parent B and then parent A; each part
 * kept is the most of the parts after it that still fit, so when the base or a parent goes, the
 * references and examples that fit without it come back. Throws when it doesn't fit with all of
 * them trimmed.
 * @param {PromptRevision} revision
 * @param {PromptParts} parts
 * @returns {Prompt}
 */
export function buildPrompt(
  revision,
  { budgetTokens, examples, base = null, references = [], parents = null, ...rest },
) {
  if (base !== null && parents !== null) {
    throw new Error("a prompt holds an explore's base or two parents, not both");
  }
  /** @param {Trimmable} kept */
  const fits = (kept) =>
    estimateTokens(promptText(messages(revision, { ...rest, ...kept }))) <= budgetTokens;
  const given = parents === null ? [] : [parents.a, parents.b];
  /** @param {readonly unknown[]} kept */
  const bare = (kept) => ({ examples: [], references: [], base: null, parents: kept });
  let keptParents = given;
  while (keptParents.length > 0 && !fits(bare(keptParents))) keptParents = keptParents.slice(0, -1);
  const keptBase = base !== null && !fits({ ...bare([]), base }) ? null : base;
  /** @type {Trimmable} */
  const floor = { ...bare(keptParents), base: keptBase };
  if (!fits(floor)) {
    const size = estimateTokens(promptText(messages(revision, { ...rest, ...floor })));
    const none =
      base !== null
        ? "no examples and no base"
        : parents !== null
          ? "no examples and no parents"
          : "no examples";
    throw new Error(
      `the prompt is about ${size} tokens with ${none}, over the ${budgetTokens}-token budget; shorten the vibe's brief or notes`,
    );
  }
  let keptReferences = references;
  while (keptReferences.length > 0 && !fits({ ...floor, references: keptReferences })) {
    keptReferences = keptReferences.slice(0, -1);
  }
  let kept = examples;
  while (kept.length > 0 && !fits({ ...floor, examples: kept, references: keptReferences }))
    kept = kept.slice(0, -1);
  return {
    messages: messages(revision, {
      ...rest,
      ...floor,
      examples: kept,
      references: keptReferences,
    }),
    exampleIds: kept.map((e) => e.id),
    referenceIds: keptReferences.map((r) => r.id),
    baseTrimmed: keptBase !== base,
    parentsTrimmed: PARENT_LETTERS.slice(keptParents.length, given.length).reverse(),
  };
}

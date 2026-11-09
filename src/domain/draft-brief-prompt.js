// The prompt that drafts a brief from the owner's words (decision 0074): a system message with
// the answer format, every constraint kind and range feature read from their own tables, and
// each tuning's keys and scales from the genome's schema text; and a user message with the
// owner's words and, when there is one, the brief as it is now. The repair round quotes the
// errors back as a follow-up turn (0024, 0036).
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { ConstraintKind, Constraints } from "./constraint-schema.js" */
/** @import { ChatMessage } from "./prompt-tokens.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
import { valueText } from "../engine/descriptor.js";
import { pitchLines } from "../engine/schema-text.js";
import { requireVoiceType, voiceTypeIds } from "../engine/voice-registry.js";
import { quotedErrors } from "./build-repair-prompt.js";
import { CONSTRAINT_KINDS, FORM } from "./constraint-schema.js";
import { followUp } from "./follow-up.js";
import { estimateTokens, promptText, ROLE } from "./prompt-tokens.js";
import { quoted } from "./references-text.js";
import { RANGES_KEY, rangeWords, TARGET_FEATURES } from "./target-schema.js";
import { RANGE_ENDS } from "./validate-constraints.js";
import { VIBE_DRAFT_FIELD } from "./vibe-draft.js";

/**
 * The most characters the name and the description may hold, as the save route takes them.
 * @typedef {{ name: number, brief: number }} DraftLimits
 */

/**
 * A brief's whole draft, checked: what the model is given to rework and what it answers.
 * @typedef {object} BriefDraft
 * @property {string} name
 * @property {string} brief
 * @property {Constraints} constraints
 * @property {{ features?: FeatureRanges }} softTargets the ranges alone; other saved keys are
 *   the page's to keep
 */

/**
 * @typedef {object} DraftAsk
 * @property {string} words the owner's
 * @property {BriefDraft | null} current the brief as the page holds it, to rework; null to
 *   draft one from the words alone
 * @property {DraftLimits} limits
 */

/** @param {string} key */
const at = (key) => JSON.stringify(key);

const { name, brief, constraints, softTargets } = VIBE_DRAFT_FIELD;
const [LOW, HIGH] = /** @type {[string, string]} */ (RANGE_ENDS);
const DRAFT_FORMAT = `{${at(name)}: <a short name>, ${at(brief)}: <the description>, ${at(constraints)}: {<kind>: <value>, …}, ${at(softTargets)}: {${at(RANGES_KEY)}: {<feature>: [<low or null>, <high or null>], …}}}`;

/**
 * What one kind's value is written as.
 * @param {ConstraintKind<unknown>} kind
 */
function valueShape({ form, value }) {
  if (form === FORM.voices) return "a list of voice types";
  const text = valueText(/** @type {Descriptor} */ (value));
  if (form === FORM.range) return `{${at(LOW)}: ${text}, ${at(HIGH)}: ${text}}`;
  return form === FORM.ceiling ? `the most, ${text}` : text;
}

/**
 * A value of the kind, for its prompt line to show how the candidates' model reads it.
 * @param {ConstraintKind<unknown>} kind
 * @returns {unknown}
 */
function sample({ form, value }) {
  if (form === FORM.voices) return voiceTypeIds().slice(0, 2);
  // No constraint kind takes a recording, so every descriptor here has a default.
  const descriptor = /** @type {{ default: unknown, min?: number, max?: number }} */ (value);
  if (form === FORM.range) return { [LOW]: descriptor.min, [HIGH]: descriptor.max };
  return descriptor.default;
}

const KIND_LINES = Object.entries(CONSTRAINT_KINDS).map(([kindName, entry]) => {
  const kind = /** @type {ConstraintKind<unknown>} */ (entry);
  return `  ${at(kindName)}: ${valueShape(kind)}; read as, for one value: ${kind.text(sample(kind))}`;
});

const VOICE_LINES = voiceTypeIds().map(
  (type) => `  ${type}: ${requireVoiceType(type).description}`,
);

const FEATURE_LINES = Object.entries(TARGET_FEATURES).map(
  ([featureName, { feature, least, most }]) =>
    `  ${at(featureName)}: ${feature.label}; each end ${rangeWords([least, most], feature.unit)}, or null for an open end`,
);

/** @param {DraftLimits} limits */
const system = (limits) =>
  [
    "You write briefs for a generative ambient music engine. A brief has a name, a description that another model reads each time it writes a candidate, hard rules every candidate must follow, and feature ranges each candidate's excerpt is measured against. The owner says in plain words how the brief should be; you write the whole brief.",
    `Answer with one JSON object and nothing else: ${DRAFT_FORMAT}`,
    "",
    "Rules:",
    `- ${at(name)} is a few words, at most ${limits.name} characters. ${at(brief)} describes the music in plain sentences: mood, sounds, how it moves and how fast; at most ${limits.brief} characters.`,
    `- ${at(constraints)}: set a kind only where the owner's words call for it, and leave it out to leave it free; {} sets none. Each kind and its value:`,
    ...KIND_LINES,
    "- The voice types:",
    ...VOICE_LINES,
    "- Each tuning's keys and scales; a fixed scale or key must be one of its tuning's:",
    ...pitchLines(),
    `- ${at(softTargets)}: give a feature a range only where the words say how it should sound, and leave it out for no range; {${at(RANGES_KEY)}: {}} gives none. Each excerpt is measured after it is normalized to the brief's loudness. Each feature:`,
    ...FEATURE_LINES,
  ].join("\n");

/**
 * The draft as the prompt quotes it, with the ranges alone under its soft targets.
 * @param {BriefDraft} draft
 */
const draftJson = (draft) =>
  JSON.stringify({
    ...draft,
    [softTargets]: { [RANGES_KEY]: draft.softTargets[RANGES_KEY] ?? {} },
  });

/**
 * @param {DraftAsk} ask
 * @returns {ChatMessage[]}
 */
function messages({ words, current, limits }) {
  const user =
    current === null
      ? [`The owner's words for the brief, as a JSON string: ${quoted(words)}`, "Write the brief."]
      : [
          `The brief now, as JSON: ${draftJson(current)}`,
          `The owner's words for how it should change, as a JSON string: ${quoted(words)}`,
          "Write the whole brief again with these changes, and keep what the words don't ask to change.",
        ];
  return [
    { role: ROLE.system, content: system(limits) },
    { role: ROLE.user, content: user.join("\n\n") },
  ];
}

/**
 * The prompt for one draft. Throws when it is over `budgetTokens`.
 * @param {DraftAsk} ask
 * @param {number} budgetTokens the most the prompt may take
 * @returns {ChatMessage[]}
 */
export function buildDraftBriefPrompt(ask, budgetTokens) {
  const built = messages(ask);
  const tokens = estimateTokens(promptText(built));
  if (tokens > budgetTokens) {
    throw new Error(
      `the brief's prompt is about ${tokens} tokens, over its ${budgetTokens}-token budget; shorten the description or your words`,
    );
  }
  return built;
}

/**
 * The repair as a follow-up turn on the prompt sent, quoting every error.
 * @param {{ messages: ChatMessage[], answer: unknown }} previous
 * @param {readonly QuotedError[]} errors
 * @returns {ChatMessage[]}
 */
export function buildDraftBriefRepair({ messages: sent, answer }, errors) {
  if (errors.length === 0) throw new Error("a brief's repair quotes at least one error");
  const ask = [
    "Your brief was rejected for these errors. Paths start at the answer.",
    ...quotedErrors(errors),
    `Fix every error and answer again with the whole corrected object, and nothing else: ${DRAFT_FORMAT}`,
  ].join("\n");
  return followUp(sent, answer, ask);
}

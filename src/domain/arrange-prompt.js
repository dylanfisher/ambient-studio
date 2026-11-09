// The proposal prompt (decision 0067): a system message with the arrangement's answer format and
// its rules, from the arrangement's own descriptors, and a user message with the brief, the
// length and arc the owner asked for, a reference region's numbers stretched over the track, and
// one line per piece of material, at most `MAX_MATERIAL_LINES`, with no genomes, so the context
// stays short. The answer gives every section and transition a line of text drawn from the arc
// (0082). The repair round quotes the errors back as a follow-up turn (0024, 0036).
/** @import { Features } from "./extract-features.js" */
/** @import { FeatureName } from "./feature-names.js" */
/** @import { ChatMessage } from "./prompt-tokens.js" */
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { MacroWindow } from "./macro-window.js" */
import { MACROS } from "../engine/genome-schema.js";
import { MORPH_LEAST } from "../engine/morph.js";
import { MAX_DURATION } from "../engine/timeline.js";
import { CURVES } from "../engine/trajectory.js";
import {
  ARRANGEMENT_KEY,
  MAX_TEXT_CHARS,
  MAX_TRACK_SECONDS,
  MORPH_CURVE,
  SECTION_FIELDS,
  SECTION_KEY,
  TEXT_KEY,
  TRANSITION_KEYS,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "./arrangement-schema.js";
import { quotedErrors } from "./build-repair-prompt.js";
import { featureValue } from "./feature-names.js";
import { followUp } from "./follow-up.js";
import { LANE_FIELDS, LANE_MOST_POINTS, LANE_OFFSET } from "./lane-schema.js";
import { percentiles } from "./percentiles.js";
import { estimateTokens, promptText, ROLE } from "./prompt-tokens.js";
import { quoted } from "./references-text.js";
import { TARGET_FEATURES } from "./target-schema.js";

/** The most lines of material one prompt lists: sketches first, then the map's elites. */
export const MAX_MATERIAL_LINES = 24;

/** How far the track may play from the length asked for, as a share of it, before it's a finding. */
export const LENGTH_TOLERANCE = 0.05;

/** The spans the reference arc's numbers are given over, evenly across the track. */
export const ARC_SPANS = 8;

/** The most characters of an intent, notes or tags a material line quotes. */
const CLIP_CHARS = 60;

/** The key a section names an elite by in place of `sketchId`: the elite's candidate id. */
export const ELITE_KEY = "eliteId";

/** The keys the model's answer holds; the server fills the rest of the arrangement. */
export const ANSWER_KEYS = Object.freeze([
  ARRANGEMENT_KEY.sections,
  ARRANGEMENT_KEY.transitions,
  ARRANGEMENT_KEY.lanes,
]);

/** What a material line is: a kept sketch, or an elite of the brief's map not yet kept. */
export const MATERIAL_KIND = Object.freeze(
  /** @type {const} */ ({ sketch: "sketch", elite: "elite" }),
);

/**
 * One piece of material as the prompt reads it.
 * @typedef {object} MaterialItem
 * @property {(typeof MATERIAL_KIND)[keyof typeof MATERIAL_KIND]} kind
 * @property {number} id a sketch's id, or an elite's candidate id
 * @property {string | null} intent its candidate's, or the nearest parent's for an elite
 * @property {string} notes the owner's; "" for an elite
 * @property {readonly string[]} tags the owner's; empty for an elite
 * @property {number} duration its genome's, in seconds
 * @property {Features | null} features its excerpt's, as measured; null when it has none
 * @property {Readonly<Record<string, MacroWindow>>} macros each macro over the whole genome
 * @property {number | null} score an elite's search score; null for a sketch, or with no model
 * @property {number} misses an elite's ranges missed; 0 for a sketch
 */

/**
 * A reference region's window as the analysis gives it.
 * @typedef {{ startSeconds: number, seconds: number, features: Features }} ArcWindow
 */

/**
 * @typedef {object} ArrangeAsk
 * @property {string} name the brief's
 * @property {string} brief
 * @property {number} length seconds the owner asked for
 * @property {string} arc the owner's words
 * @property {readonly ArcWindow[] | null} reference the arc region's windows; null for none
 * @property {readonly MaterialItem[]} material most wanted first, as `arrangeMaterial` orders it
 * @property {number} budgetTokens the most the first prompt may take
 */

/**
 * The material most wanted first, at most `MAX_MATERIAL_LINES`: the sketches newest first, since
 * the owner kept them, then the elites by score, highest first, those with none after, then by
 * fewest ranges missed, then newest.
 * @param {readonly MaterialItem[]} sketches
 * @param {readonly MaterialItem[]} elites
 * @returns {MaterialItem[]}
 */
export function arrangeMaterial(sketches, elites) {
  const newest = [...sketches].sort((a, b) => b.id - a.id);
  const best = [...elites].sort(
    (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.misses - b.misses || b.id - a.id,
  );
  return [...newest, ...best].slice(0, MAX_MATERIAL_LINES);
}

/**
 * @param {string} text
 * @returns {string} at most `CLIP_CHARS`, an ellipsis ending a clipped one
 */
const clip = (text) => (text.length > CLIP_CHARS ? `${text.slice(0, CLIP_CHARS - 1)}…` : text);

/** @param {number} value */
const two = (value) => Number(value.toFixed(2));

const MEASURED = Object.values(TARGET_FEATURES).map(({ feature }) => feature);
const MACRO_NAMES = Object.keys(MACROS);

/**
 * The measured features the ranges name, in `MEASURED`'s order, values only: the material's
 * heading names them once, so 24 lines stay short.
 * @param {Features} features
 */
const featuresLine = (features) => valuesLine((entry) => featureValue(features, entry));

/**
 * @param {(entry: FeatureName) => number | null} read
 */
const valuesLine = (read) =>
  MEASURED.map((entry) => {
    const value = read(entry);
    return value === null ? "none" : value.toFixed(entry.digits);
  }).join(", ");

/**
 * Each macro's value, or its least and most when it moves, in `MACROS`' order.
 * @param {Readonly<Record<string, MacroWindow>>} macros
 */
const macrosLine = (macros) =>
  MACRO_NAMES.map((name) => {
    const window = macros[name];
    if (!window) throw new Error(`the material line has no ${name} macro`);
    const [min, max] = [two(window.min), two(window.max)];
    return min === max ? `${min}` : `${min} to ${max}`;
  }).join(", ");

/** What the values on a material line are, in order, for the material's heading. */
const MATERIAL_LEGEND = [
  `After measured come its excerpt's ${MEASURED.map(({ label, unit }) => (unit ? `${label} (${unit})` : label)).join(", ")}.`,
  `After macros come its ${MACRO_NAMES.join(", ")}, each 0 to 1, or the least and most of one that moves.`,
].join(" ");

/**
 * One material line, as in `sketch 12: 300 s; intent "…"; …`. Owner text is quoted as JSON
 * strings, so it can't end the line or start one of its own.
 * @param {MaterialItem} item
 * @returns {string}
 */
export function materialLine({ kind, id, intent, notes, tags, duration, features, macros }) {
  return [
    `${kind} ${id}: ${duration} s`,
    ...(intent === null ? [] : [`intent ${quoted(clip(intent))}`]),
    ...(notes === "" ? [] : [`notes ${quoted(clip(notes))}`]),
    ...(tags.length === 0 ? [] : [`tags ${quoted(clip(tags.join(", ")))}`]),
    features === null ? "not measured" : `measured ${featuresLine(features)}`,
    `macros ${macrosLine(macros)}`,
  ].join("; ");
}

/**
 * The reference arc's numbers: the region's windows stretched over the track, as the timeline
 * draws them (0066), and for each of `ARC_SPANS` even spans of the track the median of each
 * feature over the windows whose middle falls in it. A span no window's middle falls in is left
 * out.
 * @param {readonly ArcWindow[]} windows at least one
 * @param {number} length the track's, in seconds
 * @returns {string[]}
 */
export function arcLines(windows, length) {
  const regionLength = Math.max(
    ...windows.map(({ startSeconds, seconds }) => startSeconds + seconds),
  );
  const stretch = length / regionLength;
  const span = length / ARC_SPANS;
  return Array.from({ length: ARC_SPANS }, (_, i) => {
    const inside = windows.filter(({ startSeconds, seconds }) => {
      const middle = (startSeconds + seconds / 2) * stretch;
      return middle >= i * span && (middle < (i + 1) * span || i === ARC_SPANS - 1);
    });
    if (inside.length === 0) return null;
    const medians = valuesLine((entry) => {
      const values = inside
        .map(({ features }) => featureValue(features, entry))
        .filter((value) => value !== null);
      return values.length === 0 ? null : percentiles(values).p50;
    });
    return `${Math.round(i * span)} to ${Math.round((i + 1) * span)} s: measured ${medians}`;
  }).filter((line) => line !== null);
}

/** How long a track plays, in words, for the rule and the length finding. */
export const LENGTH_RULE = "every section's seconds less every transition's";

/** The answer format, written the way the model should write it. */
const [KIND, SECONDS, CURVE] = /** @type {[string, string, string]} */ (
  TRANSITION_KEYS[TRANSITION_KIND.morph]
);
const [MACRO, POINTS] = /** @type {[string, string]} */ (LANE_FIELDS);
/** @param {string} key */
const at = (key) => JSON.stringify(key);
const SECTION_TEXT = `${at(TEXT_KEY)}: "<what happens here>"`;
const TRANSITION_TEXT = `${at(TEXT_KEY)}: "<how one becomes the next>"`;
const ARRANGE_FORMAT = `{${at(ARRANGEMENT_KEY.sections)}: [{${at(SECTION_KEY.sketchId)}: <a sketch's id>, ${at(SECTION_KEY.offset)}: <seconds>, ${at(SECTION_KEY.seconds)}: <seconds>, ${SECTION_TEXT}}, …], ${at(ARRANGEMENT_KEY.transitions)}: [{${at(KIND)}: ${at(TRANSITION_KIND.crossfade)}, ${at(SECONDS)}: <seconds>, ${TRANSITION_TEXT}} or {${at(KIND)}: ${at(TRANSITION_KIND.morph)}, ${at(SECONDS)}: <seconds>, ${at(CURVE)}: ${at(MORPH_CURVE)}, ${TRANSITION_TEXT}}, …], ${at(ARRANGEMENT_KEY.lanes)}: [{${at(MACRO)}: "<macro>", ${at(POINTS)}: [[<track seconds>, <offset>], [<track seconds>, <offset>, "<curve>"], …]}, …]}`;

const { offset, seconds } = SECTION_FIELDS;
const curves = Object.keys(CURVES).join(", ");

const SYSTEM = [
  "You arrange tracks for a generative ambient music engine. The owner gives a length, an arc in words and their material; you choose which material plays, in what order, for how long, and how each part passes to the next.",
  `Answer with one JSON object and nothing else: ${ARRANGE_FORMAT}`,
  "",
  "Rules:",
  `- A section plays one piece of material: name a sketch by ${at(SECTION_KEY.sketchId)}, or an elite by ${at(ELITE_KEY)} in its place. Material may play in more than one section.`,
  `- "${SECTION_KEY.offset}" is where the section starts on its material's own timeline, from ${offset.min} s and under the material's duration. "${SECTION_KEY.seconds}" is how long it plays, ${seconds.min} to ${seconds.max} s; past the material's end it is extended, but offset plus seconds is at most ${MAX_DURATION} s.`,
  `- Give exactly one transition between each pair of neighboring sections, in order: ${TRANSITION_KIND.crossfade} fades one into the next; ${TRANSITION_KIND.morph} moves the first one's settings into the second's, and is at least ${MORPH_LEAST} s. A transition is ${TRANSITION_SECONDS.min} s or more, and at most half the shorter of its two sections.`,
  `- The track plays ${LENGTH_RULE}, at most ${MAX_TRACK_SECONDS} s.`,
  `- Give every section and every transition its ${at(TEXT_KEY)}: one short line, at most ${MAX_TEXT_CHARS} characters, drawn from the owner's arc. For a section, what happens there; for a transition, how the section before it becomes the one after. Each section is later developed from its line.`,
  `- Lanes are optional: at most one per macro (${Object.keys(MACROS).join(", ")}), each at most ${LANE_MOST_POINTS} points with track times rising from 0. A point's offset, ${LANE_OFFSET.min} to ${LANE_OFFSET.max}, is added to each section's own macro there. The first point is [seconds, offset]; every later one names the curve into it, one of ${curves}. Give "${ARRANGEMENT_KEY.lanes}": [] for none.`,
].join("\n");

/**
 * @param {Omit<ArrangeAsk, "budgetTokens">} ask
 * @returns {ChatMessage[]}
 */
function messages({ name, brief, length, arc, reference, material }) {
  const spread = Math.round(length * LENGTH_TOLERANCE);
  const arcNumbers =
    reference === null
      ? []
      : [
          [
            "A reference region the owner chose as the arc to follow, stretched over the track's length: the median of each measurement, in the material's order, over each span of the track. Aim the sections at these numbers in turn:",
            ...arcLines(reference, length),
          ].join("\n"),
        ];
  const user = [
    `Brief: ${name}\n${brief}`,
    `Length: ${length} s. The track must play within ${LENGTH_TOLERANCE * 100}% of it, from ${length - spread} to ${length + spread} s.`,
    `The owner's arc, as a JSON string: ${quoted(arc)}`,
    ...arcNumbers,
    [
      `The material, ${material.length === 1 ? "1 line" : `${material.length} lines`}, each with its duration, intent, and the owner's notes and tags. ${MATERIAL_LEGEND}`,
      ...material.map(materialLine),
    ].join("\n"),
    "Arrange the track: follow the arc over the length asked for, and write each part's line.",
  ].join("\n\n");
  return [
    { role: ROLE.system, content: SYSTEM },
    { role: ROLE.user, content: user },
  ];
}

/**
 * The prompt for one proposal, its material trimmed from the end until it fits `budgetTokens`.
 * Throws when it doesn't fit with one line of material, or when there is none.
 * @param {ArrangeAsk} ask
 * @returns {{ messages: ChatMessage[], material: MaterialItem[] }} the material the prompt lists
 */
export function buildArrangePrompt({ budgetTokens, ...ask }) {
  if (ask.material.length === 0) {
    throw new Error("a proposal needs at least one sketch or elite to arrange");
  }
  for (let count = ask.material.length; count > 0; count--) {
    const material = ask.material.slice(0, count);
    const built = messages({ ...ask, material });
    if (estimateTokens(promptText(built)) <= budgetTokens) return { messages: built, material };
  }
  const tokens = estimateTokens(
    promptText(messages({ ...ask, material: ask.material.slice(0, 1) })),
  );
  throw new Error(
    `the proposal's prompt is about ${tokens} tokens with one line of material, over its ${budgetTokens}-token budget; shorten the brief`,
  );
}

/**
 * The repair as a follow-up turn on the prompt sent, quoting every error.
 * @param {{ messages: ChatMessage[], answer: unknown }} previous
 * @param {readonly QuotedError[]} errors
 * @returns {ChatMessage[]}
 */
export function buildArrangeRepair({ messages, answer }, errors) {
  if (errors.length === 0) throw new Error("a proposal's repair quotes at least one error");
  const ask = [
    "Your arrangement was rejected for these errors. Paths start at the answer.",
    ...quotedErrors(errors),
    `Fix every error and answer again with the whole corrected object, and nothing else: ${ARRANGE_FORMAT}`,
  ].join("\n");
  return followUp(messages, answer, ask);
}

// The develop prompt (decision 0079): one section of a track rewritten as its own genome. A
// system message with the task, the answer format and the genome schema as the generation
// prompt gives it (0024), and a user message with the brief, the track's arc, the owner's words
// for the section, its seconds, the sketch's genome and its readings (0078), and where the
// neighbors meet it. A bridge's (0081) holds the owner's words for the join instead, with the
// two states it starts and ends in and the rules its ends are checked by. Over its budget the
// lineage's reading goes first, then the sketch's. The repair round quotes the errors back as a
// follow-up turn (0024, 0036).
/** @import { NumberDescriptor } from "../engine/descriptor.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { BridgePart } from "./bridge-plan.js" */
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { PromptRevision } from "./build-prompt.js" */
/** @import { ChatMessage } from "./prompt-tokens.js" */
import { conciseGenome } from "../engine/canonical-genome.js";
import { GLOBAL_PARAMS, MAX_VOICES } from "../engine/genome-schema.js";
import { schemaText } from "../engine/schema-text.js";
import { MAX_POINTS } from "../engine/trajectory.js";
import { BRIDGE_PART } from "./bridge-plan.js";
import { quotedErrors } from "./build-repair-prompt.js";
import { KEYLESS } from "./check-bridge.js";
import { constraintsText } from "./constraints-text.js";
import { followUp } from "./follow-up.js";
import { exactText } from "./param-text.js";
import { listed } from "./preference-text.js";
import { estimateTokens, promptText, ROLE } from "./prompt-tokens.js";
import { quoted } from "./references-text.js";
import { targetsText } from "./targets-text.js";

/**
 * The shortest section that can be developed: its genome lasts the section's seconds, and a genome
 * lasts at least this.
 */
export const DEVELOP_LEAST = GLOBAL_PARAMS.duration.min;

/** The answer format, written the way the model should write it. */
const DEVELOP_FORMAT = "{<the section's whole genome>}";

/** What a join must match to morph or weave rather than crossfade (0064). */
const JOINED = "tuning, scale, key, pulse and bpm";

const SYSTEM = [
  "You develop one section of a track for a generative ambient music engine. A track plays sketches of one brief one after another. The owner placed a sketch in this section and wrote what should happen there; you write the section's own genome, which starts from the sketch and changes over the section's seconds the way the owner's words ask.",
  `Answer with one JSON object and nothing else, the whole genome: ${DEVELOP_FORMAT}`,
  "Rules:",
  "- duration is exactly the section's seconds, and fadeIn and fadeOut are 0: the track fades itself.",
  `- Make the changes over time: with trajectories (at most ${MAX_POINTS} points each), and with voices' start and end, so a voice enters or leaves where the words ask. At most ${MAX_VOICES} voices.`,
  "- Keep a voice's id while it continues from the sketch: a voice's events are drawn from its id, so a voice that keeps its id and its settings plays the sketch's notes.",
  `- Keep the sketch's ${JOINED} unless the owner's words ask for a change: a neighbor meets this section with a morph or a weave only when these match, and otherwise the join crossfades.`,
  "- Keep the sketch's field recordings, if it has any; no other recording is available.",
  "- Stay within the brief's rules below.",
  "",
  schemaText(),
].join("\n");

/**
 * The sketch the section plays, as the prompt reads it.
 * @typedef {object} DevelopSketch
 * @property {number} id
 * @property {Genome} genome its stored genome, normalized
 * @property {readonly string[]} reading `sketchReading`'s lines
 * @property {readonly string[]} lineage `lineageReading`'s lines
 */

/**
 * What the prompt is written from.
 * @typedef {object} DevelopParts
 * @property {PromptRevision} revision the brief, as the generation prompt reads it
 * @property {string | null} arc the track's, or null when the owner wrote none
 * @property {number} index the section's, from 0
 * @property {number} count the track's sections
 * @property {{ offset: number, seconds: number, text: string }} section as it stands on the
 *   timeline, on its sketch
 * @property {DevelopSketch} sketch
 * @property {readonly string[] | null} before `meetingState` of the section before at its end;
 *   null for the first section
 * @property {readonly string[] | null} after `meetingState` of the section after at its start;
 *   null for the last section
 * @property {DevelopBridge} [bridge] when the section is a bridge, or one half of it (0081):
 *   `before` and `after` are then the states it starts and ends in, and `section.text` the
 *   owner's words for the join
 */

/**
 * A bridge between two sections, as its prompt reads it (decision 0081).
 * @typedef {object} DevelopBridge
 * @property {BridgePart} part
 * @property {number} from the outgoing section's number, from 1
 * @property {number} to the incoming section's number
 * @property {number} into the seconds of the weave from the outgoing section
 * @property {number} out the seconds of the weave into the incoming section
 * @property {number | null} middle the crossfade's seconds between two halves
 * @property {readonly string[]} differs the join globals the two sections differ in
 * @property {boolean} keyless whether only voices with no pitch cross between the halves
 * @property {Partial<Record<string, number>>} held the fixed globals both sections have
 */

/**
 * The parts and the most tokens the first prompt may take.
 * @typedef {DevelopParts & { budgetTokens: number }} DevelopAsk
 */

/** The readings the prompt can leave out for room, in the order they go. */
export const DEVELOP_TRIM = Object.freeze(
  /** @type {const} */ ({ lineage: "lineage", reading: "reading" }),
);

/** @typedef {(typeof DEVELOP_TRIM)[keyof typeof DEVELOP_TRIM]} DevelopTrim */

/**
 * @param {string} heading
 * @param {readonly string[]} lines
 */
const block = (heading, lines) => [heading, ...lines].join("\n");

/**
 * The parts of a bridge's user message that differ from a section's: where it sits, the words,
 * the two states under their headings, the rules its ends are checked by, and the ask.
 * @param {DevelopParts} ask
 * @param {DevelopBridge} bridge
 */
function bridgeParts({ index, count, section, sketch, before, after }, bridge) {
  const { seconds, text } = section;
  const { part, from, to, into, out, middle, differs, keyless, held } = bridge;
  const number = index + 1;
  const what = part === BRIDGE_PART.whole ? "this bridge" : "this half";
  const halves = `Section ${to} has another ${listed([...differs])}, which one genome can't change, so the bridge is two halves with a crossfade of ${middle} s between them`;
  const place = {
    [BRIDGE_PART.whole]: `Section ${number} of ${count}, ${seconds} s, is a bridge the owner asked for between section ${from} and section ${to}: it starts where section ${from} ends and ends where section ${to} starts, and a ${into} s weave joins it to section ${from} and a ${out} s weave to section ${to}. It starts from sketch ${sketch.id}, which section ${from} plays.`,
    [BRIDGE_PART.first]: `Section ${number} of ${count}, ${seconds} s, is the first half of a bridge the owner asked for between section ${from} and section ${to}. ${halves}: this one keeps section ${from}'s, and section ${number + 1}, the second half, has section ${to}'s. A ${into} s weave joins it to section ${from}. It starts from sketch ${sketch.id}, which section ${from} plays.`,
    [BRIDGE_PART.second]: `Section ${number} of ${count}, ${seconds} s, is the second half of a bridge the owner asked for between section ${from} and section ${to}. ${halves}: section ${number - 1}, the first half, keeps section ${from}'s, and this one has section ${to}'s. A ${out} s weave joins it to section ${to}. It starts from sketch ${sketch.id}, which section ${to} plays.`,
  }[part];
  const words =
    text === ""
      ? `The owner wrote nothing for this join: move from section ${from} to section ${to} so the change sounds intended.`
      : `The owner's words for how section ${from} should become section ${to}, as a JSON string: ${quoted(text)}`;
  const second = part === BRIDGE_PART.second;
  const starts = second ? `the first half` : `section ${from}`;
  const states = [
    ...(before === null
      ? []
      : [
          block(
            second
              ? `Where section ${number - 1}, the first half, ends, the state this half starts in:`
              : `Where section ${from} ends, the state ${what} starts in:`,
            before,
          ),
        ]),
    ...(after === null
      ? []
      : [block(`Where section ${to} starts, the state ${what} ends in:`, after)]),
  ];
  const fixed = Object.entries(held).map(
    ([name, value]) =>
      `${name} ${exactText(/** @type {number} */ (value), /** @type {NumberDescriptor} */ (GLOBAL_PARAMS[/** @type {keyof typeof GLOBAL_PARAMS} */ (name)]).unit)}`,
  );
  const only = `only voices with no pitch sound (types ${KEYLESS.join(", ")})`;
  const rules = [
    `The ends of ${what} are checked before it is used:`,
    `- At 0 s it holds exactly the voices sounding where ${starts} ends, with the same ids, types and settings (every value that isn't a trajectory), each from 0 s to at least ${second ? middle : into} s, and no other voice sounds at 0 s; its ${JOINED} are section ${second ? to : from}'s.`,
    ...(part === BRIDGE_PART.first
      ? [
          keyless
            ? `- From ${seconds - /** @type {number} */ (middle)} s ${only}: end every other voice by then, since the second half starts from the voices sounding at ${seconds} s, in another key. Keep one of them to the end so the halves cross on sound; with none, they cross in silence.`
            : `- The second half starts from the voices sounding at ${seconds} s, with the same settings.`,
        ]
      : [
          `- At ${seconds} s it holds exactly the voices sounding where section ${to} starts, the same way, each from ${seconds - out} s or earlier to ${seconds} s, and no other voice sounds at ${seconds} s.`,
        ]),
    ...(second && keyless
      ? [`- Until ${middle} s ${only}: start every other voice then or later.`]
      : []),
    ...(fixed.length === 0
      ? []
      : [`- Keep ${listed(fixed)}: section ${from} and section ${to} have the same.`]),
    `- Between its ends, change as the owner's words ask.`,
  ];
  const write = {
    [BRIDGE_PART.whole]: `Write the bridge's genome: duration ${seconds}, starting where section ${from} ends and ending where section ${to} starts.`,
    [BRIDGE_PART.first]: `Write the first half's genome: duration ${seconds}, starting where section ${from} ends.`,
    [BRIDGE_PART.second]: `Write the second half's genome: duration ${seconds}, starting where the first half ends and ending where section ${to} starts.`,
  }[part];
  return { place, words, states, rules: rules.join("\n"), write };
}

/**
 * @param {DevelopParts} ask
 * @param {readonly DevelopTrim[]} left the readings left out
 * @returns {ChatMessage[]}
 */
function messages(ask, left) {
  const { revision, arc, index, count, section, sketch, before, after, bridge } = ask;
  const { offset, seconds, text } = section;
  const targets = targetsText(revision.ranges);
  const number = index + 1;
  const bridged = bridge === undefined ? null : bridgeParts(ask, bridge);
  const user = [
    `Brief: ${revision.name}\n${revision.brief}`,
    constraintsText(revision.constraints),
    ...(targets === "" ? [] : [targets]),
    arc === null
      ? "The owner wrote no arc for this track."
      : `The track's arc, as a JSON string: ${quoted(arc)}`,
    bridged === null
      ? [
          `Section ${number} of ${count}, ${seconds} s. It plays sketch ${sketch.id} from ${offset} s on the sketch's timeline, so the sketch's ${offset} s is the section's 0 s.`,
          text === ""
            ? "The owner wrote nothing for this section: develop the sketch so it holds together over its seconds and meets its neighbors."
            : `The owner's words for this section, as a JSON string: ${quoted(text)}`,
        ].join("\n")
      : `${bridged.place}\n${bridged.words}`,
    block(`Sketch ${sketch.id}'s genome:`, [conciseGenome(sketch.genome)]),
    ...(left.includes(DEVELOP_TRIM.reading)
      ? []
      : [block(`Sketch ${sketch.id}, read in short lines:`, sketch.reading)]),
    ...(left.includes(DEVELOP_TRIM.lineage)
      ? []
      : [block(`How sketch ${sketch.id} was made:`, sketch.lineage)]),
    ...(bridged === null
      ? [
          before === null
            ? "This is the first section: nothing plays before it."
            : block(`Where section ${number - 1} ends, as this section starts:`, before),
          after === null
            ? "This is the last section: nothing plays after it."
            : block(`Where section ${number + 1} starts, as this section ends:`, after),
          `Write section ${number}'s genome: duration ${seconds}, starting from the sketch and changing as the owner's words ask.`,
        ]
      : [...bridged.states, bridged.rules, bridged.write]),
  ].join("\n\n");
  return [
    { role: ROLE.system, content: SYSTEM },
    { role: ROLE.user, content: user },
  ];
}

/**
 * The prompt for one section, leaving out the lineage's reading and then the sketch's when it is
 * over `budgetTokens`. Throws when it doesn't fit with both left out.
 * @param {DevelopAsk} ask
 * @returns {{ messages: ChatMessage[], left: DevelopTrim[] }} the readings left out
 */
export function buildDevelopPrompt({ budgetTokens, ...ask }) {
  /** @type {DevelopTrim[]} */
  const left = [];
  for (const next of [null, DEVELOP_TRIM.lineage, DEVELOP_TRIM.reading]) {
    if (next !== null) left.push(next);
    const built = messages(ask, left);
    if (estimateTokens(promptText(built)) <= budgetTokens) return { messages: built, left };
  }
  const tokens = estimateTokens(promptText(messages(ask, left)));
  throw new DevelopPromptTooLong(
    `the develop prompt is about ${tokens} tokens with both readings left out, over its ${budgetTokens}-token budget; the sketch's genome is about ${estimateTokens(conciseGenome(ask.sketch.genome))} of them`,
    tokens,
    budgetTokens,
  );
}

/**
 * A develop prompt that doesn't fit its budget with both readings left out, so the bridge route
 * can refuse it before any request (decision 0082).
 */
export class DevelopPromptTooLong extends Error {
  /**
   * @param {string} message
   * @param {number} tokens the prompt's, with both readings left out
   * @param {number} budgetTokens
   */
  constructor(message, tokens, budgetTokens) {
    super(message);
    this.name = "DevelopPromptTooLong";
    this.tokens = tokens;
    this.budgetTokens = budgetTokens;
  }
}

/**
 * The repair as a follow-up turn on the prompt sent, quoting every error.
 * @param {{ messages: ChatMessage[], answer: unknown }} previous
 * @param {readonly QuotedError[]} errors
 * @returns {ChatMessage[]}
 */
export function buildDevelopRepair({ messages: sent, answer }, errors) {
  if (errors.length === 0) throw new Error("a development's repair quotes at least one error");
  const ask = [
    "Your genome was rejected for these errors. Paths start at the genome.",
    ...quotedErrors(errors),
    `Fix every error and answer again with the whole corrected genome, and nothing else: ${DEVELOP_FORMAT}`,
  ].join("\n");
  return followUp(sent, answer, ask);
}

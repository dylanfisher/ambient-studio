// The field sets the words operator may change (decisions 0084, 0085), by name. A route takes a
// set by its name and never takes field definitions from the page. Each set says what its
// fields set, where their values now are read from, and its fields as descriptors, built from
// what the route reads on its own: a search's paths, a candidate's genome, the brief's
// directions, the track's arrangement (0087).
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Arrangement } from "./arrangement-schema.js" */
/** @import { TrackContext, TrackDetail, TrackEdit, TrackTarget } from "./track-words.js" */
import { choice, number } from "../engine/descriptor.js";
import { MACROS } from "../engine/genome-schema.js";
import { arrangementLength } from "./arrangement-length.js";
import { SECTION_FIELDS, TRANSITION_KIND, TRANSITION_SECONDS } from "./arrangement-schema.js";
import { nearText } from "./axis-words.js";
import { EAR_SHIFT } from "./ear-settings.js";
import { LANE_OFFSET } from "./lane-schema.js";
import { lockChoices } from "./lock-choices.js";
import { macroWords } from "./macro-words.js";
import { MACRO_DIRECTIONS } from "./rating-values.js";
import {
  applyLane,
  applyLength,
  applyTransition,
  laneCurrent,
  laneField,
  laneGrid,
  laneNarrower,
  laneReading,
  laneRoom,
  lengthCurrent,
  lengthReading,
  TRACK_TARGET,
  transitionCurrent,
  transitionReading,
} from "./track-words.js";

/**
 * Where a set's values now come from, and so which route asks it. `page`: the page sends them,
 * unsaved, and the words route checks them against the set's descriptors. `candidate`: the same,
 * and the page names the candidate the fields belong to, whose genome the route reads for the
 * fields and whose reading goes in the prompt (0085). `earSearch`: the running search by ear's
 * steering, read by the search's own route. `track`: the page sends the track's arrangement as
 * it is now, unsaved, and names the part the fields change; the route checks the arrangement as
 * Save would and reads the values now and the reading from it (0087).
 */
export const WORDS_SCOPE = Object.freeze({
  page: "page",
  candidate: "candidate",
  earSearch: "ear-search",
  track: "track",
});

/** @typedef {(typeof WORDS_SCOPE)[keyof typeof WORDS_SCOPE]} WordsScope */

/** A brief's direction (0056) as a field set reads it. */
/** @typedef {{ id: number, near: string | null, far: string }} WordsDirection */

/**
 * What a set's fields are built from. Each set reads only its own, and throws when it is missing.
 * @typedef {object} WordsContext
 * @property {readonly string[]} [paths] the paths a search by ear moves
 * @property {Arrangement} [arrangement] a track set's, valid
 * @property {number | string} [target] what a track set changes in it
 * @property {readonly string[]} [names] each section's name, for a track set's reading
 * @property {TrackDetail} [detail] how much of the track the lane set reads
 * @property {Genome} [genome] the candidate's
 * @property {readonly WordsDirection[]} [directions] the brief's live directions
 * @property {number} [voicesWithParams] how many of the genome's voices, from the first, list
 *   each parameter as well as the whole voice; every voice when absent. The route lowers it
 *   when the prompt is over its budget.
 */

/**
 * @typedef {object} WordsSet
 * @property {string} subject what the fields set, as the prompt's first line names it
 * @property {WordsScope} scope
 * @property {string} [label] what the session card's select calls a candidate's set
 * @property {(context: WordsContext) => Readonly<Record<string, Descriptor>>} fields each
 *   field's descriptor by name
 * @property {(context: WordsContext) => WordsContext | null} [narrower] the same fields with
 *   fewer of them, or a shorter reading, for a prompt over its budget, or null when there is
 *   none narrower
 * @property {TrackTarget} [target] a track set's: what its `target` names
 * @property {(context: TrackContext) => Record<string, unknown>} [current] a track set's values
 *   now, read from the arrangement
 * @property {(context: TrackContext, changes: Readonly<Record<string, unknown>>) => TrackEdit}
 *   [apply] a track set's checked answer applied to the arrangement
 * @property {(context: TrackContext) => string[]} [reading] a track set's reading, which the
 *   prompt holds in place of the one the route is given
 * @property {(context: TrackContext) => string | null} [refusal] why a track set can't be asked
 *   of this part of the track at all, before any request, or null when it can
 */

/** A lock field's two values: locked keeps the value as the candidate has it. */
export const LOCK_STATE = Object.freeze({ locked: "locked", free: "free" });

/** A macro field's values: the owner's Less or More choice, or none (0031). */
export const MACRO_NONE = "none";

const [MORE, LESS] = MACRO_DIRECTIONS;

const DIRECTION_FIELD = "direction";

/**
 * A steer field's name for a direction: the name is the answer's key, and the page maps it back
 * to the direction's slider with `fieldDirection`.
 * @param {number} id the direction's attachment id
 */
export const directionField = (id) => `${DIRECTION_FIELD}${id}`;

/**
 * The direction id a steer field names, or null when it names none.
 * @param {string} field
 * @returns {number | null}
 */
export function fieldDirection(field) {
  const id = Number(field.slice(DIRECTION_FIELD.length));
  return Number.isInteger(id) && directionField(id) === field ? id : null;
}

/**
 * @template T
 * @param {T | undefined} value
 * @param {string} what
 * @returns {T}
 */
function needs(value, what) {
  if (value === undefined) throw new Error(`this field set needs ${what}`);
  return value;
}

/**
 * A track set's context, with the arrangement and target it needs.
 * @param {WordsContext} context
 * @returns {TrackContext}
 */
const track = ({ arrangement, target, names, detail }) => ({
  arrangement: needs(arrangement, "the track's arrangement"),
  target: needs(target, "what it changes"),
  ...(names === undefined ? {} : { names }),
  ...(detail === undefined ? {} : { detail }),
});

/** @param {WordsContext} context */
function lockFields({ genome, voicesWithParams }) {
  const groups = lockChoices(needs(genome, "a genome"));
  const voices = needs(genome, "a genome").voices.length;
  const listed = voicesWithParams ?? voices;
  // Groups are the whole piece, the macros, then one per voice, whole voice first.
  const kept = groups.flatMap(({ choices }, i) =>
    i < 2 || i - 2 < listed ? choices : choices.slice(0, 1),
  );
  return Object.fromEntries(
    kept.map(({ path, description }) => [
      path,
      choice({ values: Object.values(LOCK_STATE), default: LOCK_STATE.free, description }),
    ]),
  );
}

export const WORDS_SETS = Object.freeze(
  /** @satisfies {Record<string, WordsSet>} */ ({
    /** A search by ear's shift sliders (0075): each path the run moves, from -1 to 1. */
    shift: {
      subject:
        "how far each new variation a search by ear plays leans from the best so far, on each control: -1 is less of it, 1 more of it, 0 no lean; 0.25 a little, 0.5 clearly, 1 as far as it goes",
      scope: WORDS_SCOPE.earSearch,
      fields: ({ paths }) =>
        Object.fromEntries(needs(paths, "the search's paths").map((path) => [path, EAR_SHIFT])),
    },
    /** A candidate's locks (0035): each lockable path, locked or free. */
    locks: {
      subject:
        "which of this candidate's values the brief keeps exactly as they are in every later candidate: locked keeps it, free lets later candidates change it. A whole voice keeps every parameter of it",
      scope: WORDS_SCOPE.candidate,
      label: "What it locks",
      fields: lockFields,
      narrower: (context) => {
        const voices = needs(context.genome, "a genome").voices.length;
        const listed = context.voicesWithParams ?? voices;
        return listed === 0 ? null : { ...context, voicesWithParams: listed - 1 };
      },
    },
    /** A candidate's Less / More choices (0031, 0032): one per macro. */
    macros: {
      subject: `what the listener tells the studio this candidate should have less or more of: ${LESS}, ${MORE}, or ${MACRO_NONE} for no choice`,
      scope: WORDS_SCOPE.candidate,
      label: "Its Less / More choices",
      fields: () =>
        Object.fromEntries(
          Object.keys(MACROS).map((macro) => {
            const { less, more } = macroWords(macro);
            return [
              macro,
              choice({
                values: [LESS, MACRO_NONE, MORE],
                default: MACRO_NONE,
                description: `${LESS} is ${less}, ${MORE} is ${more}`,
              }),
            ];
          }),
        ),
    },
    /** Where Steer from here aims on each of the brief's directions (0056). */
    steer: {
      subject:
        "where a steer from this candidate aims on each of the brief's directions, on the brief's own scale: 0 is the brief's least of it so far, 1 its most",
      scope: WORDS_SCOPE.candidate,
      label: "Where Steer from here aims",
      fields: ({ directions }) =>
        Object.fromEntries(
          needs(directions, "the brief's directions").map(({ id, near, far }) => [
            directionField(id),
            number({
              min: 0,
              max: 1,
              default: 0.5,
              unit: "",
              description: `from ${nearText(near)} at 0 to “${far}” at 1`,
            }),
          ]),
        ),
    },
    /** A section's seconds on the timeline (0061). */
    length: {
      subject:
        "how long one section of a track plays, in seconds; its neighbors overlap it by their transitions' seconds",
      scope: WORDS_SCOPE.track,
      label: "Its length",
      target: TRACK_TARGET.section,
      fields: () => ({ seconds: SECTION_FIELDS.seconds }),
      current: lengthCurrent,
      apply: applyLength,
      reading: lengthReading,
    },
    /** How a section passes into the next: its kind (0064, 0080) and seconds. */
    transition: {
      subject:
        "how one section of a track becomes the next: the kind of transition and how many seconds the two overlap",
      scope: WORDS_SCOPE.track,
      label: "How it becomes the next",
      target: TRACK_TARGET.transition,
      fields: () => ({
        kind: choice({
          values: Object.values(TRANSITION_KIND),
          default: TRANSITION_KIND.crossfade,
          description: `${TRANSITION_KIND.crossfade}: one fades out as the next fades in; ${TRANSITION_KIND.morph}: the first section's sounds move toward the next one's before it takes over; ${TRANSITION_KIND.weave}: a morph whose sounds that can't move hand over one at a time`,
        }),
        seconds: TRANSITION_SECONDS,
      }),
      current: transitionCurrent,
      apply: applyTransition,
      reading: transitionReading,
    },
    /** A macro lane (0065), read and set at every `LANE_GRID_SECONDS` of the track. */
    lane: {
      subject:
        "one macro lane of a track: an offset added to that macro of every section, read at every 30 s of the track. Give the offset at each time where a change starts, turns and ends; between the times you give the lane moves evenly, and before the first and after the last it stays as it is now",
      scope: WORDS_SCOPE.track,
      target: TRACK_TARGET.macro,
      fields: (context) =>
        Object.fromEntries(
          laneGrid(arrangementLength(track(context).arrangement)).map((time) => [
            laneField(time),
            number({ ...LANE_OFFSET, description: `the offset ${time} s into the track` }),
          ]),
        ),
      current: laneCurrent,
      apply: applyLane,
      reading: laneReading,
      narrower: (context) => laneNarrower(track(context)),
      refusal: laneRoom,
    },
  }),
);

/**
 * The set by its name, or undefined when there is none.
 * @param {string} name
 * @returns {WordsSet | undefined}
 */
export const wordsSet = (name) =>
  Object.hasOwn(WORDS_SETS, name)
    ? WORDS_SETS[/** @type {keyof typeof WORDS_SETS} */ (name)]
    : undefined;

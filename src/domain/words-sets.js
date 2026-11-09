// The field sets the words operator may change (decisions 0084, 0085), by name. A route takes a
// set by its name and never takes field definitions from the page. Each set says what its
// fields set, where their values now are read from, and its fields as descriptors, built from
// what the route reads on its own: a search's paths, a candidate's genome, the brief's
// directions.
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { choice, number } from "../engine/descriptor.js";
import { MACROS } from "../engine/genome-schema.js";
import { nearText } from "./axis-words.js";
import { EAR_SHIFT } from "./ear-settings.js";
import { lockChoices } from "./lock-choices.js";
import { macroWords } from "./macro-words.js";
import { MACRO_DIRECTIONS } from "./rating-values.js";

/**
 * Where a set's values now come from, and so which route asks it. `page`: the page sends them,
 * unsaved, and the words route checks them against the set's descriptors. `candidate`: the same,
 * and the page names the candidate the fields belong to, whose genome the route reads for the
 * fields and whose reading goes in the prompt (0085). `earSearch`: the running search by ear's
 * steering, read by the search's own route.
 */
export const WORDS_SCOPE = Object.freeze({
  page: "page",
  candidate: "candidate",
  earSearch: "ear-search",
});

/** @typedef {(typeof WORDS_SCOPE)[keyof typeof WORDS_SCOPE]} WordsScope */

/** A brief's direction (0056) as a field set reads it. */
/** @typedef {{ id: number, near: string | null, far: string }} WordsDirection */

/**
 * What a set's fields are built from. Each set reads only its own, and throws when it is missing.
 * @typedef {object} WordsContext
 * @property {readonly string[]} [paths] the paths a search by ear moves
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
 *   fewer of them, for a prompt over its budget, or null when there is none narrower
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

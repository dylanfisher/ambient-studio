// The field sets the words operator may change (decision 0084), by name. A route takes a set by
// its name and never takes field definitions from the page. Each set says what its fields set,
// where their values now are read from, and its fields as descriptors.
/** @import { Descriptor } from "../engine/descriptor.js" */
import { EAR_SHIFT } from "./ear-settings.js";

/**
 * Where a set's values now come from, and so which route asks it. `page`: the page sends them,
 * unsaved, and the words route checks them against the set's descriptors. `earSearch`: the
 * running search by ear's steering, read by the search's own route, since the search holds the
 * job runner while it runs.
 */
export const WORDS_SCOPE = Object.freeze({ page: "page", earSearch: "ear-search" });

/** @typedef {(typeof WORDS_SCOPE)[keyof typeof WORDS_SCOPE]} WordsScope */

/**
 * @typedef {object} WordsSet
 * @property {string} subject what the fields set, as the prompt's first line names it
 * @property {WordsScope} scope
 * @property {(paths: readonly string[]) => Readonly<Record<string, Descriptor>>} fields each
 *   field's descriptor by name; a set whose fields are the paths something moves takes them
 *   from `paths`, and a set of fixed fields ignores it
 */

export const WORDS_SETS = Object.freeze(
  /** @satisfies {Record<string, WordsSet>} */ ({
    /** A search by ear's shift sliders (0075): each path the run moves, from -1 to 1. */
    shift: {
      subject:
        "how far each new variation a search by ear plays leans from the best so far, on each control: -1 is less of it, 1 more of it, 0 no lean; 0.25 a little, 0.5 clearly, 1 as far as it goes",
      scope: WORDS_SCOPE.earSearch,
      fields: (paths) => Object.fromEntries(paths.map((path) => [path, EAR_SHIFT])),
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

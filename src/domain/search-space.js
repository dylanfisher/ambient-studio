// The paths an optimizer searches (decision 0053): the macros the locks and the vibe leave free,
// plus the raw paths the owner chose from `searchPaths`. Each is one dimension of [0, 1]^d.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { GENOME_KEY } from "../engine/genome-schema.js";
import { vectorPaths } from "../engine/vector-view.js";
import { searchPaths } from "./search-paths.js";

/** The most dimensions a search takes; past it a few hundred evaluations is a few per dimension. */
export const MAX_SEARCH_DIMENSIONS = 24;

/** Why a search job that starts with no dimension fails: the locks changed since its request. */
export const NO_SEARCH_SPACE = "every macro is locked or fixed by the brief and no path was chosen";

/** @param {string} path */
const isMacro = (path) => path.startsWith(`${GENOME_KEY.macros}.`);

/**
 * The free macros, then the chosen raw paths, each group in the vector view's order. Throws on a
 * chosen path that is a macro, chosen twice, or not one `searchPaths` offers (locked, fixed by
 * the vibe, or not a number of this genome), and on more than `MAX_SEARCH_DIMENSIONS` in all.
 * @param {Genome} genome with the locks applied
 * @param {readonly Lock[]} locks
 * @param {Constraints} constraints
 * @param {readonly string[]} raw the owner's chosen paths; none by default
 * @returns {string[]}
 */
export function searchSpace(genome, locks, constraints, raw) {
  const free = searchPaths(genome, locks, constraints, vectorPaths(genome));
  const chosen = new Set(raw);
  if (chosen.size !== raw.length) throw new Error("the search space names a path twice");
  for (const path of raw) {
    if (isMacro(path)) throw new Error(`${path} is a macro, which every search moves already`);
    if (!free.includes(path)) {
      throw new Error(`${path} can't be searched: it is locked, fixed by the vibe or not a number`);
    }
  }
  const space = [...free.filter(isMacro), ...free.filter((path) => chosen.has(path))];
  if (space.length > MAX_SEARCH_DIMENSIONS) {
    throw new Error(
      `the search space has ${space.length} dimensions, and a search takes at most ${MAX_SEARCH_DIMENSIONS}`,
    );
  }
  return space;
}

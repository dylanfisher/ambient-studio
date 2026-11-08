// The vector paths a search may move (decisions 0037, 0053): those the owner's locks and the
// vibe's fixed values leave free. Nudges, optimizers and the archive's emitter all read it.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { CONSTRAINT_KINDS, FORM } from "./constraint-schema.js";
import { lockedPaths } from "./locked-paths.js";

/**
 * The global parameters the vibe's constraints fix to one value. A fixed kind is named for the
 * parameter it fixes (`constraint-schema.js`), and a move there could only fail the linter.
 * @param {Constraints} constraints
 */
const fixedByVibe = (constraints) =>
  Object.keys(constraints).filter(
    (kind) => CONSTRAINT_KINDS[/** @type {keyof Constraints} */ (kind)].form === FORM.fixed,
  );

/**
 * The paths of `chosen` that neither a lock covers nor the vibe fixes, in `chosen`'s order.
 * Throws when the genome can't take the locks.
 * @param {Genome} genome with the locks applied
 * @param {readonly Lock[]} locks
 * @param {Constraints} constraints
 * @param {readonly string[]} chosen vector paths of `genome`
 * @returns {string[]}
 */
export function searchPaths(genome, locks, constraints, chosen) {
  const held = new Set([...lockedPaths(locks, genome), ...fixedByVibe(constraints)]);
  return chosen.filter((path) => !held.has(path));
}

// The vector paths the owner's locks hold (decision 0035), which nudges and optimizers leave
// alone. Choices, flags and recordings have no vector path; `applyLocks` alone holds them.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Lock } from "./validate-lock.js" */
import { vectorPaths } from "../engine/vector-view.js";
import { applyLocks } from "./apply-locks.js";
import { lockCovers } from "./lock-path.js";

/**
 * The vector paths of `genome` with the locks applied that the locks cover, in the vector view's
 * order. A whole trajectory covers its `.start` and `.end`; a number locked over a parameter the
 * genome holds as a trajectory covers the plain path it becomes; a whole voice covers every
 * numeric path of the voice. Throws when the genome can't take the locks (`applyLocks` findings).
 * @param {readonly Lock[]} locks validated locks
 * @param {Genome} genome a normalized genome
 * @returns {string[]}
 */
export function lockedPaths(locks, genome) {
  const applied = applyLocks(genome, locks);
  if (applied.findings.length > 0) {
    const list = applied.findings.map((f) => `${f.path}: ${f.message}`).join("; ");
    throw new Error(`the genome can't take the locks: ${list}`);
  }
  return vectorPaths(applied.genome).filter((path) =>
    locks.some((lock) => lockCovers(lock.path, path)),
  );
}

// Breeding's mutation (decision 0058): one nudge of a crossover child at `MUTATION_STEP`, through
// `nudge` and so `proposeGenome` (0053), so the locks and the linter hold as for every optimizer.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { NudgeDraw } from "./nudge.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { MUTATION_STEP } from "./breed-settings.js";
import { nudge } from "./nudge.js";

/**
 * The draws of the child's one mutation, at most `NUDGE_DRAWS`; the last is the mutation when
 * its reason is null. Throws when the child can't take the locks.
 * @param {{ child: Genome, childId: number, locks: readonly Lock[], constraints: Constraints,
 *   seed: number }} request `childId` keys the stream, as a nudge's base id does
 * @returns {NudgeDraw[]}
 */
export function mutateChild({ child, childId, locks, constraints, seed }) {
  const [draws] = nudge({
    base: child,
    baseId: childId,
    locks,
    constraints,
    stepSize: MUTATION_STEP,
    seed,
    count: 1,
  });
  return /** @type {NudgeDraw[]} */ (draws);
}

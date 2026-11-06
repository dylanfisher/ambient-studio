// The rated genomes a generation prompt shows the model, chosen by rating and recency until CLAP
// similarity arrives in phase 4 (decision 0024). The method's name is logged with each
// generation, so a later method's results can be told apart.
/** @import { PromptExample } from "../domain/build-prompt.js" */
/** @import { Store } from "./store.js" */
import { getGenome } from "./generation-store.js";
import { listRatedGenomes } from "./rating-store.js";

export const RETRIEVAL_METHOD = "rating-recency";

/** The most liked, and the most disliked, examples one prompt shows. */
export const EXAMPLES_PER_SIDE = 3;

/**
 * The newest liked and newest disliked genomes, alternating and liked first, so trimming the
 * prompt from the end drops the oldest of both sides.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {{ method: string, examples: PromptExample[] }}
 */
export function retrieveExamples(store, vibeId) {
  const rated = listRatedGenomes(store, vibeId);
  const liked = rated.filter((r) => r.score > 0).slice(0, EXAMPLES_PER_SIDE);
  const disliked = rated.filter((r) => r.score < 0).slice(0, EXAMPLES_PER_SIDE);
  /** @type {PromptExample[]} */
  const examples = [];
  for (let i = 0; i < EXAMPLES_PER_SIDE; i++) {
    for (const [side, isLiked] of /** @type {const} */ ([
      [liked, true],
      [disliked, false],
    ])) {
      const pick = side[i];
      if (pick === undefined) continue;
      const row = getGenome(store, pick.genomeId);
      if (!row) throw new Error(`rated genome ${pick.genomeId} has no row`);
      examples.push({ id: row.id, liked: isLiked, genome: row.genome });
    }
  }
  return { method: RETRIEVAL_METHOD, examples };
}

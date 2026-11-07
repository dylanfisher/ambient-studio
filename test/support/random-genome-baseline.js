// A stand-in LLM that answers every request with `randomGenome` (decision 0030): a baseline run
// through the same pipeline as the model's, whose genomes always pass the schema and rarely a
// vibe's linter. The fake omlx only plays a script, so the script is worked out ahead: a first
// answer the linter rejects is followed by its repair's answer, as generation will ask for one.
/** @import { Constraints } from "../../src/domain/constraint-schema.js" */
/** @import { Scripted } from "./fake-omlx.js" */
import { lintGenome } from "../../src/domain/lint-genome.js";
import { randomGenome } from "../../src/engine/random-genome.js";

/** @param {number} seed */
const answer = (seed) => ({
  tokens: [JSON.stringify({ intent: `random genome ${seed}`, genome: randomGenome(seed) })],
});

/**
 * The fake omlx's script for `count` candidates of each vibe, in the order the vibes run, drawing
 * seeds from `firstSeed` up.
 * @param {readonly Constraints[]} vibes each vibe's constraints
 * @param {number} count candidates per vibe
 * @param {number} [firstSeed]
 * @returns {{ script: Scripted[], lintPasses: number }} `lintPasses` counts first answers the
 *   linter takes, so a test knows the valid rate to expect before repair
 */
export function randomGenomeScript(vibes, count, firstSeed = 0) {
  /** @type {Scripted[]} */
  const script = [];
  let seed = firstSeed;
  let lintPasses = 0;
  for (const constraints of vibes) {
    for (let i = 0; i < count; i++) {
      const first = seed++;
      script.push(answer(first));
      if (lintGenome(randomGenome(first), constraints).ok) lintPasses++;
      else script.push(answer(seed++));
    }
  }
  return { script, lintPasses };
}

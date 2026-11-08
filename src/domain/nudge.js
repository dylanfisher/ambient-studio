// Nudges (decision 0037): children of a base genome made by seeded steps in the vector view
// (0005), with no model request. Only the paths the locks and the vibe's fixed values leave free
// move; each child is decoded, locked and linted, and a draw that fails or repeats a genome is
// kept as rejected and drawn again.
/** @import { AppliedLocks } from "./apply-locks.js" */
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Proposal } from "./propose-genome.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { canonicalGenome } from "../engine/canonical-genome.js";
import { drawer } from "../engine/prng.js";
import { toVector, vectorPaths } from "../engine/vector-view.js";
import { applyLocks } from "./apply-locks.js";
import { proposeGenome } from "./propose-genome.js";
import { searchPaths } from "./search-paths.js";

/** How many children one nudge makes when the request doesn't say; the pages send it too. */
export const DEFAULT_NUDGES = 8;

/** Each step size's spread: the standard deviation of a step, in vector positions from 0 to 1. */
export const STEP_SIZE = Object.freeze({ small: 0.05, medium: 0.12, large: 0.25 });

/** @typedef {keyof typeof STEP_SIZE} StepSize */

/** The most draws one child gets before it is given up. */
export const NUDGE_DRAWS = 4;

/** @typedef {Proposal} NudgeDraw one draw for a child */

/**
 * @typedef {object} NudgeRequest
 * @property {Genome} base a normalized genome
 * @property {number} baseId the base candidate's id, part of the stream's key
 * @property {readonly Lock[]} locks the vibe's locks in force
 * @property {Constraints} constraints the vibe's, which every child is linted against
 * @property {StepSize} stepSize
 * @property {number} seed the nudge's seed, an integer in [0, 2^32)
 * @property {number} count how many children
 */

/**
 * A standard normal value from two uniform draws (Box–Muller). `1 - u` is in (0, 1], so the
 * log is finite.
 * @param {number} u
 * @param {number} v
 */
const normal = (u, v) => Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/**
 * Why a base can't be nudged under the locks, as a clause after its name ("can't take the
 * vibe's locks: …"), or null when it can.
 * @param {AppliedLocks} applied `applyLocks` on the base
 * @returns {string | null}
 */
export function lockRefusal({ findings }) {
  if (findings.length === 0) return null;
  return `can't take the vibe's locks: ${findings.map((f) => `${f.path}: ${f.message}`).join("; ")}`;
}

/**
 * Draws `count` children of the base. Each child's draws come back in order, at most
 * `NUDGE_DRAWS`; its last draw is the child when its reason is null, and every draw before it
 * was rejected. Draw `d` of child `c` takes its steps from the stream keyed on the seed, the base
 * and the step size, at event index `c × NUDGE_DRAWS + d` and slots `2i` and `2i + 1` for free
 * path `i`, so the same request always gives the same children. Throws when the base can't
 * take the locks.
 * @param {NudgeRequest} request
 * @returns {NudgeDraw[][]}
 */
export function nudge({ base, baseId, locks, constraints, stepSize, seed, count }) {
  // The base may predate a lock, so the locks go in before its vector is read.
  const applied = applyLocks(base, locks);
  const refused = lockRefusal(applied);
  if (refused !== null) throw new Error(`the base ${refused}`);
  const start = applied.genome;
  const free = searchPaths(start, locks, constraints, vectorPaths(start));
  const origin = toVector(start, free);
  const spread = STEP_SIZE[stepSize];
  const draw = drawer(seed, `:nudge:${baseId}:${stepSize}`);
  /** @type {Map<string, string>} canonical genome → what it is, for repeats */
  const seen = new Map([
    [canonicalGenome(base), "the base"],
    [canonicalGenome(start), "the base with the locks applied"],
  ]);

  /**
   * @param {number} child
   * @param {number} attempt
   * @returns {NudgeDraw}
   */
  function drawOne(child, attempt) {
    const event = child * NUDGE_DRAWS + attempt;
    const vector = origin.map((u, i) => {
      const step = spread * normal(draw(event, 2 * i), draw(event, 2 * i + 1));
      return Math.min(1, Math.max(0, u + step));
    });
    return proposeGenome(start, free, vector, { locks, constraints, seen });
  }

  return Array.from({ length: count }, (_, child) => {
    /** @type {NudgeDraw[]} */
    const draws = [];
    for (let attempt = 0; attempt < NUDGE_DRAWS; attempt++) {
      const made = drawOne(child, attempt);
      draws.push(made);
      if (made.genome) {
        seen.set(canonicalGenome(made.genome), `child ${child + 1}`);
        break;
      }
    }
    return draws;
  });
}

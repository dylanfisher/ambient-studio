// Nudges (decision 0037): children of a base genome made by seeded steps in the vector view
// (0005), with no model request. Only the paths the locks and the vibe's fixed values leave free
// move; each child is decoded, locked and linted, and a draw that fails or repeats a genome is
// kept as rejected and drawn again.
/** @import { AppliedLocks } from "./apply-locks.js" */
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Finding, LintResult } from "./lint-result.js" */
/** @import { RejectReason } from "./reject-reason.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { canonicalGenome } from "../engine/canonical-genome.js";
import { drawer } from "../engine/prng.js";
import { validateGenome } from "../engine/validate-genome.js";
import { fromVectorUnchecked, toVector, vectorPaths } from "../engine/vector-view.js";
import { applyLocks } from "./apply-locks.js";
import { CONSTRAINT_KINDS, FORM } from "./constraint-schema.js";
import { lintGenome } from "./lint-genome.js";
import { lintResult, SCHEMA_RULE } from "./lint-result.js";
import { lockedPaths } from "./locked-paths.js";
import { REJECT_REASON } from "./reject-reason.js";

/** Each step size's spread: the standard deviation of a step, in vector positions from 0 to 1. */
export const STEP_SIZE = Object.freeze({ small: 0.05, medium: 0.12, large: 0.25 });

/** @typedef {keyof typeof STEP_SIZE} StepSize */

/** The most draws one child gets before it is given up. */
export const NUDGE_DRAWS = 4;

/**
 * One draw for a child. A draw that passed has `reason` null and its genome; one that failed has
 * the genome as drawn in `written`, for the rejected candidate's row.
 * @typedef {object} NudgeDraw
 * @property {RejectReason | null} reason
 * @property {LintResult} lint
 * @property {Genome | null} genome the child, with the locks applied; null when rejected
 * @property {unknown} written the genome as drawn
 * @property {{ locksChanged: string[], locksFilled: string[] } | null} lockChanges as an
 *   answer's: what `applyLocks` restored, null when no lock is in force
 */

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
 * The global parameters the vibe's constraints fix to one value. A fixed kind is named for the
 * parameter it fixes (`constraint-schema.js`), and a move there could only fail the linter.
 * @param {Constraints} constraints
 */
const fixedByVibe = (constraints) =>
  Object.keys(constraints).filter(
    (kind) => CONSTRAINT_KINDS[/** @type {keyof Constraints} */ (kind)].form === FORM.fixed,
  );

/**
 * A standard normal value from two uniform draws (Box–Muller). `1 - u` is in (0, 1], so the
 * log is finite.
 * @param {number} u
 * @param {number} v
 */
const normal = (u, v) => Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/**
 * @param {Partial<NudgeDraw> & Pick<NudgeDraw, "reason">} draw
 * @param {Finding[]} findings
 * @returns {NudgeDraw}
 */
const rejected = (draw, findings) => ({
  lint: lintResult(findings),
  genome: null,
  written: null,
  lockChanges: null,
  ...draw,
});

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
  const held = new Set([...lockedPaths(locks, start), ...fixedByVibe(constraints)]);
  const free = vectorPaths(start).filter((path) => !held.has(path));
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
    const written = fromVectorUnchecked(start, free, vector);
    const validated = validateGenome(written);
    if (!validated.ok) {
      const findings = validated.errors.map((e) => ({ ...e, rule: SCHEMA_RULE }));
      return rejected({ reason: REJECT_REASON.schemaErrors, written }, findings);
    }
    const locked = applyLocks(validated.genome, locks);
    if (locked.findings.length > 0) {
      return rejected({ reason: REJECT_REASON.schemaErrors, written }, locked.findings);
    }
    const repeats = seen.get(canonicalGenome(locked.genome));
    if (repeats !== undefined) {
      const finding = {
        path: "$",
        rule: REJECT_REASON.repeated,
        message: `the draw repeats ${repeats}`,
      };
      return rejected({ reason: REJECT_REASON.repeated, written }, [finding]);
    }
    const lint = lintGenome(locked.genome, constraints);
    if (!lint.ok) return rejected({ reason: REJECT_REASON.lintErrors, written }, lint.findings);
    const lockChanges =
      locks.length === 0 ? null : { locksChanged: locked.changed, locksFilled: locked.filled };
    return { reason: null, lint, genome: locked.genome, written, lockChanges };
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

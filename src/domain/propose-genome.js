// One point of a search turned into a genome a candidate can hold (decisions 0037, 0053): moved
// in the vector view, validated, locked, checked for a repeat and linted. A point that fails a
// step comes back rejected, with the genome as written, so it is stored and never rendered.
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { Finding, LintResult } from "./lint-result.js" */
/** @import { RejectReason } from "./reject-reason.js" */
/** @import { Lock } from "./validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { canonicalGenome } from "../engine/canonical-genome.js";
import { validateGenome } from "../engine/validate-genome.js";
import { fromVectorUnchecked } from "../engine/vector-view.js";
import { applyLocks } from "./apply-locks.js";
import { lintGenome } from "./lint-genome.js";
import { lintResult, SCHEMA_RULE } from "./lint-result.js";
import { REJECT_REASON } from "./reject-reason.js";

/**
 * A proposal. One that passed has `reason` null and its genome; one that failed has the genome
 * as written in `written`, for the rejected candidate's row.
 * @typedef {object} Proposal
 * @property {RejectReason | null} reason
 * @property {LintResult} lint
 * @property {Genome | null} genome the genome, with the locks applied; null when rejected
 * @property {unknown} written the genome as the vector wrote it
 * @property {{ locksChanged: string[], locksFilled: string[] } | null} lockChanges as an
 *   answer's: what `applyLocks` restored, null when no lock is in force
 */

/**
 * @typedef {object} ProposalContext
 * @property {readonly Lock[]} locks the vibe's locks in force
 * @property {Constraints} constraints the vibe's, which the genome is linted against
 * @property {ReadonlyMap<string, string>} seen canonical genome → what it is, as the base; a
 *   genome found here is rejected as a repeat
 */

/**
 * @param {Partial<Proposal> & Pick<Proposal, "reason">} proposal
 * @param {Finding[]} findings
 * @returns {Proposal}
 */
const rejected = (proposal, findings) => ({
  lint: lintResult(findings),
  genome: null,
  written: null,
  lockChanges: null,
  ...proposal,
});

/**
 * The genome `start` becomes with each of `paths` set from its position in `vector`.
 * @param {Genome} start with the locks applied
 * @param {readonly string[]} paths free paths, from `searchPaths`
 * @param {readonly number[]} vector a position from 0 to 1 for each path
 * @param {ProposalContext} context
 * @returns {Proposal}
 */
export function proposeGenome(start, paths, vector, { locks, constraints, seen }) {
  const written = fromVectorUnchecked(start, paths, vector);
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

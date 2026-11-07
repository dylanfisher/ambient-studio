// Writes the owner's locks into a genome (decision 0035): an answer keeps the model's other ideas
// and gets each locked value back, rather than being rejected for changing one.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Finding } from "./lint-result.js" */
/** @import { Lock } from "./validate-lock.js" */
import { sortedJson } from "../engine/canonical-genome.js";
import { GENOME_KEY } from "../engine/genome-schema.js";
import { validateGenome } from "../engine/validate-genome.js";
import { show } from "../engine/validation-error.js";
import {
  LOCK_KIND,
  parseLockPath,
  readLockTarget,
  voiceIndex,
  writeLockTarget,
} from "./lock-path.js";

/** The rule of a finding about a lock the genome can't take; it goes to the repair round. */
export const LOCK_RULE = "lock";

/**
 * @typedef {object} AppliedLocks
 * @property {Genome} genome the genome with every locked value in it, validated; the genome as
 *   given when there are findings
 * @property {string[]} changed the lock paths whose value the genome held otherwise, in lock order
 * @property {string[]} filled the lock paths `written` left out, a dropped voice included
 * @property {Finding[]} findings rule `lock`: a voice's parameter whose voice is missing or of
 *   another type, or a genome the locks leave invalid. Empty when the locks were applied.
 */

/**
 * Writes every locked value into `genome`. Applied to every lock or none: with findings, the
 * genome comes back as given and nothing counts as changed or filled.
 * @param {Genome} genome a normalized genome, as validation fills an answer out
 * @param {readonly Lock[]} locks validated locks
 * @param {unknown} [written] the answer's genome as the model wrote it, so a value it left out
 *   counts as filled, not changed; the genome itself when omitted, as for a nudge, which leaves
 *   nothing out
 * @returns {AppliedLocks}
 */
export function applyLocks(genome, locks, written = genome) {
  const copy = structuredClone(genome);
  /** @type {string[]} */
  const changed = [];
  /** @type {string[]} */
  const filled = [];
  /** @type {Finding[]} */
  const findings = [];
  for (const { path, value, voiceType } of locks) {
    const target = parseLockPath(path);
    if (!target) throw new Error(`lock path ${path} names no parameter or voice`);
    if (target.kind === LOCK_KIND.voiceParam) {
      const index = voiceIndex(copy, target.voiceId);
      const voice = copy.voices[index];
      const keep = `keep voice ${show(target.voiceId)} a ${voiceType} voice`;
      if (!voice) {
        findings.push({
          path: `$.${GENOME_KEY.voices}`,
          rule: LOCK_RULE,
          message: `the owner locked ${path}; keep voice ${show(target.voiceId)}, a ${voiceType} voice`,
        });
        continue;
      }
      if (voice.type !== voiceType) {
        findings.push({
          path: `$.voices[${index}].type`,
          rule: LOCK_RULE,
          message: `the owner locked ${path} on a ${voiceType} voice; ${keep}`,
        });
        continue;
      }
    }
    if (readLockTarget(written, target) === undefined) filled.push(path);
    else if (sortedJson(readLockTarget(copy, target)) !== sortedJson(value)) changed.push(path);
    writeLockTarget(copy, target, value);
  }
  if (findings.length > 0) return { genome, changed: [], filled: [], findings };
  const checked = validateGenome(copy);
  if (!checked.ok) {
    const invalid = checked.errors.map((e) => ({
      path: e.path,
      rule: LOCK_RULE,
      message: `with the owner's locks applied: ${e.message}`,
    }));
    return { genome, changed: [], filled: [], findings: invalid };
  }
  return { genome: checked.genome, changed, filled, findings };
}

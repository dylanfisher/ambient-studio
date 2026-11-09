// Checks the model's development of a section (decision 0079): the one JSON object in its
// response is the genome, validated (0005), its duration the seconds asked, its recordings the
// sketch's, linted under the brief (0020) without the brief's duration range or the excerpt's
// floor, since a development lasts its section and is never excerpted, and held to the engine's
// cost budget. An answer cut off, with no JSON or with several objects has nothing to repair
// (0024).
/** @import { Constraints } from "./constraint-schema.js" */
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { RejectReason } from "./reject-reason.js" */
import { recordingRefs } from "../engine/recording-refs.js";
import { validateGenome } from "../engine/validate-genome.js";
import { judgeAnswer } from "./judge-answer.js";
import { DURATION_PATH, EXCERPT_LENGTH_RULE, lintGenome } from "./lint-genome.js";
import { SCHEMA_RULE } from "./lint-result.js";
import { REJECT_REASON } from "./reject-reason.js";
import { costBudget } from "./render-checks.js";

/** The rule of a genome whose duration isn't the section's seconds. */
export const SECONDS_RULE = "sectionSeconds";

/**
 * @typedef {object} DevelopmentAsk
 * @property {number} seconds the section's, which the genome lasts
 * @property {Constraints} constraints the brief's, as checked when its revision was stored
 * @property {ReadonlySet<string>} recordings the hashes of the recordings the sketch plays
 */

/**
 * A rejected answer that parsed keeps `answer`, for the repair to quote; one that never parsed
 * has null, and gets no repair.
 * @typedef {{ ok: true, genome: Genome }
 *   | { ok: false, reason: RejectReason, errors: QuotedError[], answer: Record<string, unknown> | null }} DevelopmentVerdict
 */

/**
 * Checks a parsed answer, every finding with its path and rule.
 * @param {Record<string, unknown>} answer
 * @param {DevelopmentAsk} ask
 * @returns {DevelopmentVerdict}
 */
export function checkDevelopment(answer, { seconds, constraints, recordings }) {
  const validated = validateGenome(answer);
  if (!validated.ok) {
    const errors = validated.errors.map((error) => ({ ...error, rule: SCHEMA_RULE }));
    return { ok: false, reason: REJECT_REASON.schemaErrors, errors, answer };
  }
  const { genome } = validated;
  /** @type {QuotedError[]} */
  const schema = [
    ...(genome.duration === seconds
      ? []
      : [
          {
            path: DURATION_PATH,
            rule: SECONDS_RULE,
            message: `must be the section's ${seconds} s, got ${genome.duration}`,
          },
        ]),
    ...recordingRefs(genome)
      .filter(({ hash }) => !recordings.has(hash))
      .map(({ path }) => ({
        path,
        rule: SCHEMA_RULE,
        message: "the sketch plays no recording with this sha256; keep the sketch's recordings",
      })),
  ];
  if (schema.length > 0) {
    return { ok: false, reason: REJECT_REASON.schemaErrors, errors: schema, answer };
  }
  const { duration: _length, ...held } = constraints;
  const lint = [
    ...lintGenome(genome, held).findings.filter(({ rule }) => rule !== EXCERPT_LENGTH_RULE),
    ...costBudget(genome),
  ];
  if (lint.length > 0) return { ok: false, reason: REJECT_REASON.lintErrors, errors: lint, answer };
  return { ok: true, genome };
}

/**
 * The verdict on one response: cut off, no single JSON object, or the genome checked.
 * @param {{ text: string, finishReason: string }} completion
 * @param {number} maxTokens the request's, named when the answer was cut off
 * @param {DevelopmentAsk} ask
 * @returns {DevelopmentVerdict}
 */
export const judgeDevelopment = (completion, maxTokens, ask) =>
  judgeAnswer(completion, maxTokens, (answer) => checkDevelopment(answer, ask));

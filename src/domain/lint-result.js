// What the genome linter and the render checks return: every finding, each naming the JSON path
// it's about, the rule it breaks and a message a repair prompt can quote (decision 0020).

/**
 * @typedef {object} Finding
 * @property {string} path a JSONPath into the genome, as in `$.voices[0].level`
 * @property {string} rule the constraint kind or check that found it, as in `loudness`
 * @property {string} message
 */

/** @typedef {{ ok: boolean, findings: Finding[] }} LintResult */

/** The rule of a finding for a genome validator error (decision 0005). */
export const SCHEMA_RULE = "schema";

/** The rule of a finding for the shape of a model's answer around what it holds (0024, 0067). */
export const ANSWER_RULE = "answer";

/**
 * @param {Finding[]} findings
 * @returns {LintResult}
 */
export const lintResult = (findings) => ({ ok: findings.length === 0, findings });

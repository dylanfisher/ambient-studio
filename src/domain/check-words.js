// Checks the words operator's answer (decision 0084): the one JSON object in its response,
// holding `changes` and `said` and nothing else, each change naming a field that was asked about
// with a value its descriptor allows, and `said` a non-empty string. Every finding names its JSON
// path, for the one repair round (0024).
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { RejectReason } from "./reject-reason.js" */
/** @import { WordsField } from "./words-prompt.js" */
import { checkValue } from "../engine/descriptor.js";
import { isObject } from "../engine/is-object.js";
import { MISSING, show } from "../engine/validation-error.js";
import { judgeAnswer } from "./judge-answer.js";
import { ANSWER_RULE } from "./lint-result.js";
import { REJECT_REASON } from "./reject-reason.js";
import { WORDS_KEY } from "./words-prompt.js";

/**
 * A rejected answer that parsed keeps `answer`, for the repair to quote; one that never parsed
 * has null, and gets no repair (0024).
 * @typedef {{ ok: true, changes: Record<string, unknown>, said: string }
 *   | { ok: false, reason: RejectReason, errors: QuotedError[], answer: Record<string, unknown> | null }} WordsVerdict
 */

const KEYS = /** @type {readonly string[]} */ (Object.values(WORDS_KEY));

/**
 * The changes' findings: not an object, a field not asked about, or a value its descriptor
 * doesn't allow.
 * @param {unknown} changes
 * @param {readonly WordsField[]} fields
 * @returns {QuotedError[]}
 */
function changeErrors(changes, fields) {
  const rule = WORDS_KEY.changes;
  const path = `$.${rule}`;
  if (changes === undefined) return [{ path, rule, message: MISSING }];
  if (!isObject(changes)) {
    return [{ path, rule, message: `must be an object of fields, got ${show(changes)}` }];
  }
  /** @type {QuotedError[]} */
  const errors = [];
  for (const [name, value] of Object.entries(changes)) {
    const field = fields.find((f) => f.name === name);
    if (!field) {
      const known = fields.map((f) => f.name).join(", ");
      errors.push({ path: `${path}.${name}`, rule, message: `unknown field; give only ${known}` });
      continue;
    }
    /** @type {{ path: string, message: string }[]} */
    const found = [];
    checkValue(field.descriptor, value, `${path}.${name}`, found);
    errors.push(...found.map((error) => ({ ...error, rule })));
  }
  return errors;
}

/**
 * Checks a parsed answer, every finding with its path and rule.
 * @param {Record<string, unknown>} answer
 * @param {readonly WordsField[]} fields the fields asked about
 * @returns {WordsVerdict}
 */
export function checkWords(answer, fields) {
  /** @type {QuotedError[]} */
  const errors = [];
  for (const key of Object.keys(answer)) {
    if (!KEYS.includes(key)) {
      errors.push({
        path: "$",
        rule: ANSWER_RULE,
        message: `the answer has ${JSON.stringify(key)}; give only ${KEYS.map((k) => JSON.stringify(k)).join(", ")}`,
      });
    }
  }
  const changes = answer[WORDS_KEY.changes];
  errors.push(...changeErrors(changes, fields));
  const said = answer[WORDS_KEY.said];
  const saidPath = `$.${WORDS_KEY.said}`;
  if (said === undefined) {
    errors.push({ path: saidPath, rule: WORDS_KEY.said, message: MISSING });
  } else if (typeof said !== "string" || said.trim() === "") {
    errors.push({
      path: saidPath,
      rule: WORDS_KEY.said,
      message: `must be a non-empty string, got ${show(said)}`,
    });
  }
  if (errors.length > 0) return { ok: false, reason: REJECT_REASON.schemaErrors, errors, answer };
  return {
    ok: true,
    changes: /** @type {Record<string, unknown>} */ (changes),
    said: /** @type {string} */ (said),
  };
}

/**
 * The verdict on one response: cut off, no single JSON object, or the object checked.
 * @param {{ text: string, finishReason: string }} completion
 * @param {number} maxTokens the request's, named when the answer was cut off
 * @param {readonly WordsField[]} fields
 * @returns {WordsVerdict}
 */
export const judgeWords = (completion, maxTokens, fields) =>
  judgeAnswer(completion, maxTokens, (answer) => checkWords(answer, fields));

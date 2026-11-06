// Finds the one {intent, genome} answer in a model's response, fenced, bare or wrapped in prose,
// and says why when there isn't one (decision 0024). The genome is returned as written; the
// caller validates and lints it.
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { RejectReason } from "./reject-reason.js" */
import { isObject } from "../engine/is-object.js";
import { REJECT_REASON } from "./reject-reason.js";

/** The answer's keys. The genome schema has no description field, so the intent sits beside it. */
export const ANSWER_KEY = Object.freeze({ intent: "intent", genome: "genome" });

/**
 * `errors` lists what is wrong with the answer's shape, for the repair round; `intent` is null
 * and `genome` undefined when the answer doesn't give them.
 * @typedef {{
 *   ok: true,
 *   answer: Record<string, unknown>,
 *   intent: string | null,
 *   genome: unknown,
 *   errors: ValidationError[],
 * } | {
 *   ok: false,
 *   reason: RejectReason,
 *   message: string,
 * }} Extracted
 */

/**
 * Each top-level `{…}` span, by brace depth outside JSON strings; `end` is null for one that
 * never closes.
 * @param {string} text
 * @returns {{ start: number, end: number | null }[]}
 */
function objectSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let inString = false;
    /** @type {number | null} */
    let end = null;
    for (; i < text.length && end === null; i++) {
      const char = text[i];
      if (inString) {
        if (char === "\\") i++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) end = i;
    }
    spans.push({ start, end });
  }
  return spans;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
const oneLine = (value) =>
  typeof value === "string" && value.trim() !== "" && !/[\r\n]/.test(value) ? value : null;

/**
 * @param {Record<string, unknown>} answer
 * @returns {ValidationError[]}
 */
function shapeErrors(answer) {
  const { intent, genome } = ANSWER_KEY;
  /** @type {ValidationError[]} */
  const errors = [];
  if (oneLine(answer[intent]) === null) {
    errors.push({ path: "$", message: `the answer needs "${intent}", a one-line string` });
  }
  if (!Object.hasOwn(answer, genome)) {
    errors.push({ path: "$", message: `the answer needs "${genome}", the genome object` });
  }
  for (const key of Object.keys(answer)) {
    if (key !== intent && key !== genome) {
      errors.push({
        path: "$",
        message: `the answer has "${key}", which is not "${intent}" or "${genome}"`,
      });
    }
  }
  return errors;
}

/**
 * @param {string} text the response's content, without any reasoning text
 * @returns {Extracted}
 */
export function extractGenome(text) {
  const spans = objectSpans(text);
  if (spans.length === 0) {
    return {
      ok: false,
      reason: REJECT_REASON.noJson,
      message: "the response holds no JSON object",
    };
  }
  /** @type {Record<string, unknown>[]} */
  const parsed = [];
  /** The longest span that doesn't parse, as the likeliest attempt at the answer. */
  let failure = { length: -1, message: "" };
  for (const { start, end } of spans) {
    const length = (end ?? text.length) - start;
    let message = `an object opened at character ${start + 1} never closes`;
    if (end !== null) {
      try {
        const value = JSON.parse(text.slice(start, end + 1));
        if (isObject(value)) {
          parsed.push(value);
          continue;
        }
      } catch (error) {
        message = /** @type {Error} */ (error).message;
      }
    }
    if (length > failure.length) failure = { length, message };
  }
  const [answer, ...others] = parsed;
  if (answer === undefined) {
    return {
      ok: false,
      reason: REJECT_REASON.invalidJson,
      message: `the response's JSON doesn't parse: ${failure.message}`,
    };
  }
  if (others.length > 0) {
    return {
      ok: false,
      reason: REJECT_REASON.severalObjects,
      message: `the response holds ${parsed.length} JSON objects; answer with one`,
    };
  }
  return {
    ok: true,
    answer,
    intent: oneLine(answer[ANSWER_KEY.intent]),
    genome: answer[ANSWER_KEY.genome],
    errors: shapeErrors(answer),
  };
}

// Finds the one {intent, genome} answer in a model's response, fenced, bare or wrapped in prose,
// and says why when there isn't one (decision 0024). The genome is returned as written; the
// caller validates and lints it. `extractObject` is the scan alone, which 6h's arrangement
// answer goes through too (0067).
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

const OPENERS = "{[";
const CLOSERS = "}]";

/**
 * Each top-level `{…}` or `[…]` span, by bracket depth outside JSON strings; `end` is null for
 * one that never closes. A span that never closes is scanned again from its next character, so
 * a stray `{` in prose doesn't hide the answer after it.
 * @param {string} text
 * @returns {{ start: number, end: number | null }[]}
 */
function spans(text) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (!OPENERS.includes(text.charAt(i))) {
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let inString = false;
    /** @type {number | null} */
    let end = null;
    for (; i < text.length && end === null; i++) {
      const char = text.charAt(i);
      if (inString) {
        if (char === "\\") i++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (OPENERS.includes(char)) depth++;
      else if (CLOSERS.includes(char) && --depth === 0) end = i;
    }
    found.push({ start, end });
    if (end === null) i = start + 1;
  }
  return found;
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
 * The one JSON object a response holds, fenced, bare or wrapped in prose, or why there isn't
 * one. Every answer the model writes is found this way, a genome's and an arrangement's (0067).
 * @typedef {{ ok: true, answer: Record<string, unknown> } | { ok: false, reason: RejectReason, message: string }} FoundObject
 */

/**
 * @param {string} text the response's content, without any reasoning text
 * @returns {FoundObject}
 */
export function extractObject(text) {
  /** @type {Record<string, unknown>[]} */
  const parsed = [];
  /** Objects inside a top-level list, which is refused rather than unwrapped. */
  let listed = 0;
  /** The longest object span that doesn't parse, as the likeliest attempt at the answer. */
  let failure = { length: -1, message: "" };
  for (const { start, end } of spans(text)) {
    if (end === null) {
      const length = text.length - start;
      if (text.charAt(start) === "{" && length > failure.length) {
        failure = { length, message: `an object opened at character ${start + 1} never closes` };
      }
      continue;
    }
    const slice = text.slice(start, end + 1);
    /** @type {unknown} */
    let value;
    try {
      value = JSON.parse(slice);
    } catch (error) {
      // A list in prose, like "[see below]", is not an attempt at the answer.
      if (slice.includes("{") && slice.length > failure.length) {
        failure = { length: slice.length, message: /** @type {Error} */ (error).message };
      }
      continue;
    }
    if (isObject(value)) parsed.push(value);
    else if (Array.isArray(value)) listed += value.filter(isObject).length;
  }
  const [answer, ...others] = parsed;
  if (others.length > 0 || (answer !== undefined && listed > 0)) {
    return {
      ok: false,
      reason: REJECT_REASON.severalObjects,
      message: `the response holds ${parsed.length + listed} JSON objects; answer with one`,
    };
  }
  if (answer !== undefined) return { ok: true, answer };
  if (listed > 0) {
    return {
      ok: false,
      reason: REJECT_REASON.invalidJson,
      message: "the response's JSON is a list holding an object; answer with the object alone",
    };
  }
  if (failure.length < 0) {
    return {
      ok: false,
      reason: REJECT_REASON.noJson,
      message: "the response holds no JSON object",
    };
  }
  return {
    ok: false,
    reason: REJECT_REASON.invalidJson,
    message: `the response's JSON doesn't parse: ${failure.message}`,
  };
}

/**
 * @param {string} text the response's content, without any reasoning text
 * @returns {Extracted}
 */
export function extractGenome(text) {
  const found = extractObject(text);
  if (!found.ok) return found;
  const { answer } = found;
  return {
    ok: true,
    answer,
    intent: oneLine(answer[ANSWER_KEY.intent]),
    genome: answer[ANSWER_KEY.genome],
    errors: shapeErrors(answer),
  };
}

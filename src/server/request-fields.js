// Reads the fields of a JSON request body and the ids in a path (decision 0027). Each throws a
// 400 (a bad body) or a 404 (a bad id in the path) naming the field and what it got, so the UI
// can show the message as it is.
import { isObject } from "../engine/is-object.js";
import { show } from "../engine/validation-error.js";
import { HttpError } from "./routing.js";

/**
 * The longest each kind of text field may be, in characters (decision 0027). A brief at its
 * limit is about 1 150 tokens at the prompt's 3.5 characters a token, a seventh of the 8 192-token
 * context budget (0024); vibe notes feed the prompt too, so a note is kept shorter.
 */
export const MAX_CHARS = Object.freeze({
  name: 200,
  brief: 4000,
  note: 2000,
  tag: 64,
  // A lock path: `voices.`, a 16-character voice id and a parameter name fit with room to spare.
  lockPath: 64,
  // An explore's direction is one line, as "slower" or "less bell" (decision 0038).
  direction: 200,
});
/** The most tags one sketch may carry. */
export const MAX_TAGS = 32;

/** A row id: a decimal integer without a leading zero, as `/audio/:renderId` takes one. */
const ID = /^[1-9]\d{0,15}$/;

/**
 * @param {string} message
 * @returns {never}
 */
function bad(message) {
  throw new HttpError(400, message);
}

/**
 * The path's `:name` as a row id, or a 404.
 * @param {Record<string, string>} params
 * @param {string} name
 * @returns {number}
 */
export function idParam(params, name) {
  const value = params[name] ?? "";
  if (!ID.test(value)) throw new HttpError(404, `${name} must be a row id, got ${show(value)}`);
  return Number(value);
}

/**
 * The body as an object whose keys are all in `known`.
 * @param {unknown} body
 * @param {readonly string[]} known
 * @returns {Record<string, unknown>}
 */
export function fields(body, known) {
  if (!isObject(body)) bad(`the body must be a JSON object, got ${show(body)}`);
  const unknown = Object.keys(body).filter((key) => !known.includes(key));
  if (unknown.length > 0) bad(`unknown fields ${unknown.join(", ")}; known: ${known.join(", ")}`);
  return body;
}

/**
 * Checks one text value; `name` is how the message calls it.
 * @param {unknown} value
 * @param {string} name
 * @param {number} maxChars
 * @param {boolean} allowEmpty
 * @returns {string}
 */
function checkText(value, name, maxChars, allowEmpty) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    const what = allowEmpty ? `a string, "" for none` : "a non-empty string";
    bad(`${name} must be ${what}, got ${show(value)}`);
  }
  if (value.length > maxChars) {
    bad(`${name} must be at most ${maxChars} characters, got ${value.length}`);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @param {number} maxChars a `MAX_CHARS` value
 * @param {{ allowEmpty?: boolean }} [options] by default the text must hold something besides
 *   white space
 * @returns {string}
 */
export function text(body, key, maxChars, { allowEmpty = false } = {}) {
  return checkText(body[key], key, maxChars, allowEmpty);
}

/**
 * A list of at most `MAX_TAGS` non-empty tags, each at most `MAX_CHARS.tag` long.
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @returns {string[]}
 */
export function tagList(body, key) {
  const value = body[key];
  if (!Array.isArray(value)) bad(`${key} must be a list of tags, got ${show(value)}`);
  if (value.length > MAX_TAGS) {
    bad(`${key} must hold at most ${MAX_TAGS} tags, got ${value.length}`);
  }
  return value.map((tag, i) => checkText(tag, `${key}[${i}]`, MAX_CHARS.tag, false));
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @param {{ min: number, max: number }} range inclusive
 * @returns {number}
 */
export function integer(body, key, { min, max }) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    bad(`${key} must be an integer from ${min} to ${max}, got ${show(value)}`);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @returns {number} a row id
 */
export const rowId = (body, key) => integer(body, key, { min: 1, max: Number.MAX_SAFE_INTEGER });

/**
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @param {{ min: number, max: number }} range inclusive
 * @returns {number}
 */
export function finite(body, key, { min, max }) {
  const value = body[key];
  if (typeof value !== "number" || !(value >= min && value <= max)) {
    bad(`${key} must be a number from ${min} to ${max}, got ${show(value)}`);
  }
  return value;
}

/**
 * @template {string} T
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @param {readonly T[]} values
 * @returns {T}
 */
export function oneOf(body, key, values) {
  const value = /** @type {T} */ (body[key]);
  if (!values.includes(value))
    bad(`${key} must be one of ${values.join(", ")}, got ${show(value)}`);
  return value;
}

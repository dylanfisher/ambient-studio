// Reads the fields of a JSON request body and the ids in a path (decision 0027). Each throws a
// 400 (a bad body) or a 404 (a bad id in the path) naming the field and what it got, so the UI
// can show the message as it is.
import { isObject } from "../engine/is-object.js";
import { show } from "../engine/validation-error.js";
import { HttpError } from "./routing.js";

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
 * @param {Record<string, unknown>} body
 * @param {string} key
 * @returns {string} a string with something besides white space in it
 */
export function text(body, key) {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    bad(`${key} must be a non-empty string, got ${show(value)}`);
  }
  return value;
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

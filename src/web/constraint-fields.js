// The vibe page's constraints form, read from 2b's table (decision 0020) so a new kind gets its
// field with no change here. No DOM: the page builds inputs from `constraintFields`, and reads
// them back with `readConstraints` for `validateConstraints` to check.
/** @import { Descriptor } from "../engine/descriptor.js" */
import { CONSTRAINT_KINDS, FORM } from "../domain/constraint-schema.js";
import { choices, isNumeric, isRecording } from "../engine/descriptor.js";
import { voiceTypeIds } from "../engine/voice-registry.js";

/**
 * One kind's inputs. A fixed value or a ceiling is one input named `name`, a range two named
 * `name.min` and `name.max`, and a voice list one checkbox per option, all named `name`.
 * @typedef {object} ConstraintField
 * @property {string} name the kind's key in the stored set
 * @property {keyof typeof FORM} form
 * @property {string} description
 * @property {readonly string[] | null} options the choices, or null for a number
 * @property {number | null} min
 * @property {number | null} max
 * @property {string} unit
 * @property {"1" | "any"} step
 */

const ENDS = /** @type {const} */ (["min", "max"]);

/**
 * @param {string} name
 * @param {(typeof ENDS)[number]} end
 */
export const rangeInput = (name, end) => `${name}.${end}`;

/**
 * @param {string} name
 * @param {keyof typeof FORM} form
 * @param {Descriptor | undefined} value
 * @returns {ConstraintField}
 */
function field(name, form, value) {
  const numeric = value !== undefined && isNumeric(value);
  return {
    name,
    form,
    description: value?.description ?? "voice types",
    options:
      form === FORM.voices
        ? voiceTypeIds()
        : value && !numeric && !isRecording(value)
          ? choices(value).map(String)
          : null,
    min: numeric ? value.min : null,
    max: numeric ? value.max : null,
    unit: numeric ? value.unit : "",
    step: numeric && value.kind === "int" ? "1" : "any",
  };
}

/** @returns {ConstraintField[]} one per kind, in the table's order */
export const constraintFields = () =>
  Object.entries(CONSTRAINT_KINDS).map(([name, kind]) => field(name, kind.form, kind.value));

/**
 * A field's text as the number it says, or the text itself when it says none, so the validator
 * names it.
 * @param {string} text
 * @returns {number | string}
 */
function parsed(text) {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : text;
}

/**
 * The constraint set the form holds. An empty field, an empty range and a voice list with
 * nothing ticked constrain nothing, and are left out.
 * @param {(name: string) => string} get an input's value, "" when empty
 * @param {(name: string) => string[]} getAll every ticked checkbox's value
 * @returns {Record<string, unknown>}
 */
export function readConstraints(get, getAll) {
  /** @type {Record<string, unknown>} */
  const constraints = {};
  for (const { name, form, options } of constraintFields()) {
    if (form === FORM.voices) {
      const ticked = getAll(name);
      if (ticked.length > 0) constraints[name] = ticked;
    } else if (form === FORM.range) {
      /** @type {Record<string, number | string>} */
      const range = {};
      for (const end of ENDS) {
        const text = get(rangeInput(name, end));
        if (text !== "") range[end] = parsed(text);
      }
      if (Object.keys(range).length > 0) constraints[name] = range;
    } else {
      const text = get(name);
      if (text !== "") constraints[name] = options ? text : parsed(text);
    }
  }
  return constraints;
}

/**
 * The form's values for a stored set, named as `readConstraints` reads them.
 * @param {Readonly<Record<string, unknown>>} constraints
 * @returns {Record<string, string | string[]>}
 */
export function fieldValues(constraints) {
  /** @type {Record<string, string | string[]>} */
  const values = {};
  for (const { name, form } of constraintFields()) {
    const value = constraints[name];
    if (value === undefined) continue;
    if (form === FORM.voices) {
      values[name] = /** @type {string[]} */ (value);
    } else if (form === FORM.range) {
      const range = /** @type {Record<string, unknown>} */ (value);
      for (const end of ENDS) values[rangeInput(name, end)] = String(range[end]);
    } else {
      values[name] = String(value);
    }
  }
  return values;
}

/**
 * A field's title: what it limits, the values it takes, and what leaving it empty does.
 * @param {ConstraintField} field
 */
export function fieldTitle({ name, form, description, options, min, max, unit }) {
  const range = min === null ? "" : `, from ${min} to ${max}${unit ? ` ${unit}` : ""}`;
  const what = `${name} (${description}${range})`;
  if (form === FORM.voices) {
    return `Tick each voice type for the ${name} list. With no box ticked there is no such list, and the model chooses freely.`;
  }
  if (form === FORM.range) {
    return `Every candidate's ${what} must stay between these two values. Leave both empty to let the model choose.`;
  }
  if (form === FORM.ceiling) {
    return `The most ${what} a candidate may have. Leave it empty for no limit.`;
  }
  if (options) {
    return `The ${what} every candidate must use. Leave it on "free" to let the model choose.`;
  }
  return `The ${what} every candidate must have, exactly. Leave it empty to let the model choose.`;
}

// Parameter descriptors: one entry per genome parameter, read by the validator, the derived
// types, the LLM's schema text and the vector view (decision 0005).
/** @import { Trajectory } from "./trajectory.js" */
/** @import { ValidationError } from "./validation-error.js" */
import { isObject } from "./is-object.js";
import { checkTrajectory } from "./trajectory.js";
import { show } from "./validation-error.js";

/** @typedef {"linear" | "log"} Scale */

/**
 * Makes a parameter exist only when other values of the same object allow it, as a key only
 * with a relative tuning. `applies` returns undefined when a value it reads is itself invalid,
 * and the parameter is then left unchecked.
 * @typedef {object} When
 * @property {(values: Readonly<Record<string, unknown>>) => boolean | undefined} applies
 * @property {string} text what allows it, as in "only with a relative tuning"
 */

/**
 * @typedef {object} NumberDescriptor
 * @property {"number" | "int"} kind
 * @property {number} min
 * @property {number} max
 * @property {number} default
 * @property {string} unit
 * @property {Scale} scale the axis macros and optimizers move along
 * @property {boolean} trajectory whether the value may be a trajectory
 * @property {readonly [number, number]} [safe] the part of the range `randomGenome` draws from
 * @property {string} description one line for the schema text
 * @property {When} [when]
 */

/**
 * @typedef {object} EnumDescriptor
 * @property {"enum"} kind
 * @property {readonly string[]} values
 * @property {string} default
 * @property {string} description
 * @property {When} [when]
 */

/**
 * @typedef {object} BoolDescriptor
 * @property {"bool"} kind
 * @property {boolean} default
 * @property {string} description
 * @property {When} [when]
 */

/**
 * A field recording, named by the SHA-256 of its file (decision 0029). It has no default: a
 * voice that plays one names it.
 * @typedef {object} RecordingDescriptor
 * @property {"recording"} kind
 * @property {string} description
 * @property {When} [when]
 */

/** @typedef {NumberDescriptor | EnumDescriptor | BoolDescriptor | RecordingDescriptor} Descriptor */

/** @typedef {Readonly<Record<string, Descriptor>>} DescriptorTable */

/**
 * The value type a descriptor allows.
 * @template {Descriptor} D
 * @typedef {D extends { kind: "enum"; values: readonly (infer V)[] }
 *   ? V
 *   : D extends { kind: "bool" }
 *     ? boolean
 *     : D extends { kind: "recording" }
 *       ? string
 *       : D extends { trajectory: true }
 *         ? number | Trajectory
 *         : number} ValueOf
 */

/**
 * The object a descriptor table describes. A parameter with `when` may be absent.
 * @template {DescriptorTable} T
 * @typedef {{ -readonly [K in keyof T as T[K] extends { when: When } ? never : K]: ValueOf<T[K]> }
 *   & { -readonly [K in keyof T as T[K] extends { when: When } ? K : never]?: ValueOf<T[K]> }} ValuesOf
 */

/**
 * @typedef {object} NumberSpec
 * @property {number} min
 * @property {number} max
 * @property {number} default
 * @property {string} unit
 * @property {Scale} [scale] linear when omitted
 * @property {boolean} [trajectory] false when omitted
 * @property {readonly [number, number]} [safe] the part of the range `randomGenome` draws from:
 *   stable, and dark and bass-heavy where the parameter sets tone; the whole range when omitted
 * @property {string} description
 * @property {When} [when]
 */

/**
 * @param {"number" | "int"} kind
 * @param {NumberSpec} spec
 */
function numeric(kind, spec) {
  const { min, max, scale = "linear" } = spec;
  if (!(min < max)) throw new Error(`descriptor "${spec.description}": min must be below max`);
  if (scale === "log" && !(min > 0)) {
    throw new Error(`descriptor "${spec.description}": a log scale needs min > 0`);
  }
  if (!(spec.default >= min && spec.default <= max)) {
    throw new Error(
      `descriptor "${spec.description}": default ${spec.default} is outside ${min}..${max}`,
    );
  }
  if (spec.safe && !(spec.safe[0] >= min && spec.safe[0] < spec.safe[1] && spec.safe[1] <= max)) {
    throw new Error(
      `descriptor "${spec.description}": safe range ${spec.safe.join("..")} is not a part of ${min}..${max}`,
    );
  }
  if (kind === "int" && ![min, max, spec.default].every(Number.isInteger)) {
    throw new Error(`descriptor "${spec.description}": an int's range and default must be whole`);
  }
  return Object.freeze({ kind, ...spec, scale, trajectory: spec.trajectory ?? false });
}

// The constructors' return types keep the literal kind, values, `trajectory` and `when` that
// the derived genome type reads; `numeric` and `choice` check the spec at runtime.
/**
 * @template {NumberSpec} const S
 * @param {S} spec
 * @returns {NumberDescriptor & { kind: "number"; trajectory: S["trajectory"] extends true ? true : false } & Pick<S, "when" & keyof S>}
 */
export const number = (spec) => /** @type {any} */ (numeric("number", spec));

/**
 * @template {NumberSpec} const S
 * @param {S} spec
 * @returns {NumberDescriptor & { kind: "int"; trajectory: S["trajectory"] extends true ? true : false } & Pick<S, "when" & keyof S>}
 */
export const int = (spec) => /** @type {any} */ (numeric("int", spec));

/**
 * @template {string} const V
 * @template {{ values: readonly V[]; default: NoInfer<V>; description: string; when?: When }} const S
 * @param {S & { values: readonly V[] }} spec
 * @returns {EnumDescriptor & { values: readonly V[] } & Pick<S, "when" & keyof S>}
 */
export function choice(spec) {
  if (!spec.values.includes(spec.default)) {
    throw new Error(`descriptor "${spec.description}": default "${spec.default}" is not a value`);
  }
  return /** @type {any} */ (Object.freeze({ kind: "enum", ...spec }));
}

/**
 * @param {{ default: boolean; description: string }} spec
 * @returns {BoolDescriptor}
 */
export const flag = (spec) => Object.freeze({ kind: "bool", ...spec });

/** A recording's name: the SHA-256 of its file, in lowercase hex. */
const RECORDING_HASH = /^[0-9a-f]{64}$/;

/**
 * @param {{ description: string }} spec
 * @returns {RecordingDescriptor}
 */
export const recording = (spec) => Object.freeze({ kind: "recording", ...spec });

/**
 * Whether a descriptor names a field recording, which only the server can supply.
 * @param {Descriptor} descriptor
 * @returns {descriptor is RecordingDescriptor}
 */
export const isRecording = (descriptor) => descriptor.kind === "recording";

/**
 * Whether a descriptor is a number or an int, the kinds with a range and a scale.
 * @param {Descriptor} descriptor
 * @returns {descriptor is NumberDescriptor}
 */
export const isNumeric = (descriptor) => descriptor.kind === "number" || descriptor.kind === "int";

/**
 * Whether a descriptor is a choice among named values, as a bell's model.
 * @param {Descriptor} descriptor
 * @returns {descriptor is EnumDescriptor}
 */
export const isChoice = (descriptor) => descriptor.kind === "enum";

/**
 * The values an enum or a bool allows.
 * @param {EnumDescriptor | BoolDescriptor} descriptor
 * @returns {readonly (string | boolean)[]}
 */
export const choices = (descriptor) =>
  descriptor.kind === "enum" ? descriptor.values : [true, false];

/**
 * @param {Descriptor} descriptor
 * @returns {boolean}
 */
export const allowsTrajectory = (descriptor) => isNumeric(descriptor) && descriptor.trajectory;

/** @param {Descriptor} descriptor @returns {NumberDescriptor} */
function vectorizable(descriptor) {
  if (!isNumeric(descriptor)) {
    // An ordinal code for an enum would make an optimizer jump between unrelated values.
    throw new Error(`an ${descriptor.kind} parameter has no vector encoding (decision 0005)`);
  }
  return descriptor;
}

/**
 * A number or int value as a position from 0 to 1 along the descriptor's scale.
 * @param {Descriptor} descriptor
 * @param {number} value
 */
export function encode(descriptor, value) {
  const { min, max, scale } = vectorizable(descriptor);
  return scale === "log"
    ? Math.log(value / min) / Math.log(max / min)
    : (value - min) / (max - min);
}

/**
 * The inverse of `encode`, clamped to the range and rounded for an int.
 * @param {Descriptor} descriptor
 * @param {number} position
 */
export function decode(descriptor, position) {
  const { kind, min, max, scale } = vectorizable(descriptor);
  const u = Math.min(1, Math.max(0, position));
  const value = scale === "log" ? min * (max / min) ** u : min + u * (max - min);
  return Math.min(max, Math.max(min, kind === "int" ? Math.round(value) : value));
}

/**
 * @param {NumberDescriptor} descriptor
 * @param {unknown} value
 * @param {string} path
 * @param {ValidationError[]} errors
 */
function checkNumber(descriptor, value, path, errors) {
  const { kind, min, max, unit } = descriptor;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ path, message: `must be a number, got ${show(value)}` });
  } else if (kind === "int" && !Number.isInteger(value)) {
    errors.push({ path, message: `must be a whole number, got ${value}` });
  } else if (value < min || value > max) {
    const range = `${min} to ${max}${unit ? ` ${unit}` : ""}`;
    errors.push({ path, message: `must be from ${range}, got ${value}` });
  } else {
    return value;
  }
  return undefined;
}

/**
 * Checks one value against its descriptor: a number, or a trajectory where it allows one.
 * @param {Descriptor} descriptor
 * @param {unknown} value
 * @param {string} path
 * @param {ValidationError[]} errors
 * @returns {unknown} the checked value, or undefined after pushing an error
 */
export function checkValue(descriptor, value, path, errors) {
  if (descriptor.kind === "enum") {
    if (typeof value === "string" && descriptor.values.includes(value)) return value;
    const values = descriptor.values.map((v) => JSON.stringify(v)).join(", ");
    errors.push({ path, message: `must be one of ${values}, got ${show(value)}` });
    return undefined;
  }
  if (isRecording(descriptor)) {
    if (typeof value === "string" && RECORDING_HASH.test(value)) return value;
    errors.push({
      path,
      message: `must be a listed recording's sha256, 64 lowercase hex characters, got ${show(value)}`,
    });
    return undefined;
  }
  if (descriptor.kind === "bool") {
    if (typeof value === "boolean") return value;
    errors.push({ path, message: `must be true or false, got ${show(value)}` });
    return undefined;
  }
  if (!isObject(value)) return checkNumber(descriptor, value, path, errors);
  if (!allowsTrajectory(descriptor)) {
    errors.push({ path, message: "can't be a trajectory here; give a number" });
    return undefined;
  }
  return checkTrajectory(
    value,
    path,
    (point, at) => checkNumber(descriptor, point, at, errors),
    errors,
  );
}

/**
 * The allowed values in the schema text's notation: `-30..-10 LUFS`, `0..18 int`, `none|beat`.
 * @param {Descriptor} descriptor
 */
export function valueText(descriptor) {
  if (isRecording(descriptor)) return "sha256";
  if (!isNumeric(descriptor)) return choices(descriptor).join("|");
  const { kind, min, max, unit } = descriptor;
  return `${min}..${max}${unit ? ` ${unit}` : ""}${kind === "int" ? " int" : ""}`;
}

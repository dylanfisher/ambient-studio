// A genome value as the readings of a sketch and its lineage write it (decision 0078): a
// number at three significant digits with its unit, a trajectory by where it starts and ends,
// how far it swings between, and over which seconds. Short, since both readings go in a prompt.
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { Trajectory } from "../engine/trajectory.js" */
import { isNumeric } from "../engine/descriptor.js";
import { VOICE_PARAMS } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { unitText } from "./feature-names.js";
import { valueRange } from "./value-range.js";

const SECONDS = VOICE_PARAMS.start.unit;

/**
 * Three significant digits tell apart any two values a listener could; a nudge's smallest
 * step is 5% of a range.
 * @param {number} value
 */
const rounded = (value) => String(Number(value.toPrecision(3)));

/**
 * A number with its unit, as `600 Hz` or `0.35`.
 * @param {number} value
 * @param {string} unit "" for none
 */
export const numberText = (value, unit) => unitText(rounded(value), unit || null);

/**
 * A number with its unit and every digit it has, as `55.123 Hz`: for a value a check compares
 * exactly, which the model must copy as written (decision 0081). The digits are `show()`'s, as
 * a repair message quotes them.
 * @param {number} value
 * @param {string} unit "" for none
 */
export const exactText = (value, unit) => unitText(String(value), unit || null);

/**
 * A move from one number to another, the unit written once, as `37 → 55 Hz`.
 * @param {number} from
 * @param {number} to
 * @param {string} unit "" for none
 */
export const moveText = (from, to, unit) => `${rounded(from)} → ${numberText(to, unit)}`;

/**
 * A trajectory as `250 → 900 Hz over 0–3 s`, with `, ranging 200 to 1200` when it swings past
 * both ends and `, 12 points` past two points.
 * @param {Trajectory} trajectory
 * @param {Descriptor} descriptor the parameter's, for its unit and scale
 */
export function trajectoryText({ points }, descriptor) {
  if (!isNumeric(descriptor)) throw new Error("only a number may be a trajectory");
  const { unit, scale } = descriptor;
  const [[t0, first]] = points;
  const [tn, last] = /** @type {[number, number]} */ (points.at(-1));
  const [low, high] = valueRange({ points }, t0, tn, scale);
  const swings = low < Math.min(first, last) || high > Math.max(first, last);
  return [
    `${moveText(first, last, unit)} over ${rounded(t0)}–${numberText(tn, SECONDS)}`,
    swings ? `, ranging ${rounded(low)} to ${rounded(high)}` : "",
    points.length > 2 ? `, ${points.length} points` : "",
  ].join("");
}

/**
 * Any value a parameter holds: a choice as itself, a number with its unit, a trajectory as
 * `moving` and its `trajectoryText`, and an absent one (a key with an absolute tuning) as none.
 * @param {unknown} value
 * @param {Descriptor} descriptor
 */
export function paramText(value, descriptor) {
  if (value === undefined) return "not set";
  if (isObject(value))
    return `moving ${trajectoryText(/** @type {Trajectory} */ (value), descriptor)}`;
  if (typeof value === "number" && isNumeric(descriptor)) return numberText(value, descriptor.unit);
  return String(value);
}

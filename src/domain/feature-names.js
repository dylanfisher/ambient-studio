// Every feature a vibe's ranges and the revision prompt may name, in the order the prompt gives
// them (decision 0033). Integrated loudness and normalize's gain are left out: every heard
// excerpt is normalized to the vibe's target, so neither says anything the owner hears.
/** @import { Features, HeardFeatures, RawFeatures } from "./extract-features.js" */
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";

/**
 * @typedef {object} FeatureFormat
 * @property {string} label a few plain words for the prompt and the pages
 * @property {string | null} unit written after the value; null for a share from 0 to 1
 * @property {number} digits decimals the prompt rounds to, about what a listener can tell apart
 */

/**
 * @typedef {(
 *   | { set: "raw", name: Exclude<keyof RawFeatures, "loudness"> }
 *   | { set: "heard", name: Exclude<keyof HeardFeatures, "gainDb"> }
 * ) & FeatureFormat} FeatureName
 */

const LUFS = GLOBAL_PARAMS.loudness.unit;
const DBTP = GLOBAL_PARAMS.ceiling.unit;

/** @type {readonly FeatureName[]} */
export const FEATURE_NAMES = Object.freeze(
  /** @type {FeatureName[]} */ ([
    { set: "raw", name: "shortTermMax", label: "loudest 3 s", unit: LUFS, digits: 1 },
    { set: "raw", name: "loudnessRange", label: "loudness range", unit: "LU", digits: 1 },
    { set: "raw", name: "truePeak", label: "true peak", unit: DBTP, digits: 1 },
    { set: "heard", name: "centroidMean", label: "spectral centroid", unit: "Hz", digits: 0 },
    { set: "heard", name: "centroidSpread", label: "centroid spread", unit: "Hz", digits: 0 },
    { set: "heard", name: "onsetRate", label: "onset rate", unit: "a second", digits: 2 },
    { set: "heard", name: "lowEndShare", label: "low-end share", unit: null, digits: 2 },
    { set: "heard", name: "stereoWidth", label: "stereo width", unit: null, digits: 2 },
    { set: "heard", name: "flatness", label: "spectral flatness", unit: null, digits: 2 },
  ]).map((entry) => Object.freeze(entry)),
);

/**
 * Text followed by its unit, as in `1244 Hz`; a share has no unit.
 * @param {string | number} text
 * @param {string | null} unit
 * @returns {string}
 */
export const unitText = (text, unit) => (unit ? `${text} ${unit}` : String(text));

/**
 * A measured value at the digits the prompt writes, so a check reads the number the model reads.
 * @param {number} value
 * @param {number} digits
 */
export const roundFeature = (value, digits) => Number(value.toFixed(digits));

/**
 * A measured value as the prompt writes it, or "none measurable" for null.
 * @param {number | null} value
 * @param {number} digits
 * @param {string | null} unit
 * @returns {string}
 */
export const featureText = (value, digits, unit) =>
  value === null ? "none measurable" : unitText(value.toFixed(digits), unit);

/**
 * One named feature's value; null when it wasn't measurable, or was heard and nothing was.
 * @param {Features} features
 * @param {FeatureName} entry
 * @returns {number | null}
 */
export function featureValue({ raw, heard }, entry) {
  if (entry.set === "raw") return raw[entry.name];
  return heard === null ? null : heard[entry.name];
}

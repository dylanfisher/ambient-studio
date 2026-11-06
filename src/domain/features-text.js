// An excerpt's features as one line of the revision prompt (phase 3). omlx contexts are short,
// so it gives each feature once, rounded to what a listener could tell apart.
/** @import { Features } from "./extract-features.js" */
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";

const LUFS = GLOBAL_PARAMS.loudness.unit;
const DBTP = GLOBAL_PARAMS.ceiling.unit;

/**
 * @param {number | null} value
 * @param {number} digits
 * @param {string} unit
 */
const show = (value, digits, unit) =>
  value === null ? "none measurable" : `${value.toFixed(digits)} ${unit}`;

/**
 * @param {Features} features
 * @returns {string}
 */
export function featuresText({ raw, heard }) {
  const loudness =
    `Rendered at ${show(raw.loudness, 1, LUFS)} integrated, ` +
    `${show(raw.shortTermMax, 1, LUFS)} at its loudest 3 s, ` +
    `a loudness range of ${show(raw.loudnessRange, 1, "LU")} ` +
    `and a true peak of ${show(raw.truePeak, 1, DBTP)}`;
  if (heard === null) return `${loudness}; too quiet to normalize, so nothing more was measured.`;
  const sign = heard.gainDb >= 0 ? "+" : "";
  return (
    `${loudness}; heard at ${sign}${heard.gainDb.toFixed(1)} dB of gain, with a spectral ` +
    `centroid of ${show(heard.centroidMean, 0, "Hz")} (spread ${show(heard.centroidSpread, 0, "Hz")}) ` +
    `and ${heard.onsetRate.toFixed(2)} onsets a second.`
  );
}

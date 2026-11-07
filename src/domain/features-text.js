// An excerpt's features as one line of the revision prompt (phase 3). omlx contexts are short,
// so it gives each feature once, rounded to what a listener could tell apart.
/** @import { Features } from "./extract-features.js" */
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";
import { FEATURE_NAMES, featureValue } from "./feature-names.js";

const LUFS = GLOBAL_PARAMS.loudness.unit;

/**
 * @param {number | null} value
 * @param {number} digits
 * @param {string | null} unit
 */
const show = (value, digits, unit) =>
  value === null ? "none measurable" : `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;

/**
 * @param {Features} features
 * @returns {string}
 */
export function featuresText(features) {
  const { raw, heard } = features;
  // Without a heard excerpt, the heard features are left out rather than each said to be missing.
  const named = FEATURE_NAMES.filter((entry) => features[entry.set] !== null)
    .map(
      (entry) => `${entry.label}: ${show(featureValue(features, entry), entry.digits, entry.unit)}`,
    )
    .join(", ");
  const rendered = `Rendered at ${show(raw.loudness, 1, LUFS)} integrated`;
  if (heard === null) {
    return `${rendered}; ${named}; too quiet to normalize, so nothing more was measured.`;
  }
  const sign = heard.gainDb >= 0 ? "+" : "";
  return `${rendered} and heard at ${sign}${heard.gainDb.toFixed(1)} dB of gain; ${named}.`;
}

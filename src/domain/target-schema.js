// The features a vibe's soft targets may give a range, and the values a range's ends may take
// (decision 0034). Each entry is one of 3a's `FEATURE_NAMES`, whose label, unit and rounding the
// prompt, the checks and the brief page read. `validateTargets`, `targetsText` and
// `checkTargets` all read this table.
/** @import { FeatureName } from "./feature-names.js" */
import { FEATURE_NAMES, unitText } from "./feature-names.js";

/** Where the ranges sit in a vibe revision's `softTargets`. */
export const RANGES_KEY = "features";

/** A range's two ends, in the order a stored range holds them. */
export const RANGE_ENDS = Object.freeze(/** @type {const} */ (["low", "high"]));

/**
 * The values a range's ends may take, both included; null where there is no bound.
 * @typedef {{ least: number, most: number | null }} EndBounds
 */

/** @type {EndBounds} */
const SHARE = Object.freeze({ least: 0, most: 1 });
/** @type {EndBounds} */
const POSITIVE = Object.freeze({ least: 0, most: null });

/**
 * Every entry of `FEATURE_NAMES`, with its bounds or null when it takes no range. A test fails
 * when a feature is added to that list and not decided here.
 * @type {Readonly<Record<FeatureName["name"], EndBounds | null>>}
 */
export const RANGE_BOUNDS = Object.freeze({
  // Raw levels: the render's own level, which normalize cancels before the owner hears it.
  shortTermMax: null,
  loudnessRange: POSITIVE,
  truePeak: null,
  centroidMean: POSITIVE,
  centroidSpread: POSITIVE,
  onsetRate: POSITIVE,
  lowEndShare: SHARE,
  stereoWidth: SHARE,
  flatness: SHARE,
});

/** @typedef {{ feature: FeatureName } & EndBounds} TargetFeature */

/**
 * The features a range may name, in `FEATURE_NAMES` order.
 * @type {Readonly<Record<string, TargetFeature>>}
 */
export const TARGET_FEATURES = Object.freeze(
  Object.fromEntries(
    FEATURE_NAMES.flatMap((feature) => {
      const bounds = RANGE_BOUNDS[feature.name];
      return bounds === null ? [] : [[feature.name, Object.freeze({ feature, ...bounds })]];
    }),
  ),
);

/**
 * `[low, high]`, both included, either end open (null) but not both.
 * @typedef {[number | null, number | null]} FeatureRange
 */

/** @typedef {Record<string, FeatureRange>} FeatureRanges by `TARGET_FEATURES` key */

/**
 * A vibe revision's soft targets: the ranges at `features`, when there are any, and any other
 * key kept as the owner saved it.
 * @typedef {{ features?: FeatureRanges, [key: string]: unknown }} SoftTargets
 */

/**
 * A range as words, as in `from 0.1 to 0.5 a second`, `at most 800 Hz` or `at least 0.45`. Each
 * end is written as the owner wrote it.
 * @param {FeatureRange} range
 * @param {string | null} unit
 * @returns {string}
 */
export function rangeWords([low, high], unit) {
  if (low === null) return `at most ${unitText(`${high}`, unit)}`;
  if (high === null) return `at least ${unitText(`${low}`, unit)}`;
  return `from ${low} to ${unitText(`${high}`, unit)}`;
}

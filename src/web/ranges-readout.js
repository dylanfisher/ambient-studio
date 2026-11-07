// A card's features against its brief's ranges (decision 0039), one row per range with each
// miss marked. The miss is `checkTargets`'s, so the card marks what the revision pass and the
// shown-card rule count (0036), at the prompt's rounding. No DOM.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
import { checkTargets } from "../domain/check-targets.js";
import { featureText, featureValue, roundFeature } from "../domain/feature-names.js";
import { RANGES_KEY, rangeWords, TARGET_FEATURES } from "../domain/target-schema.js";

/**
 * @typedef {object} RangeRow
 * @property {string} name the feature's key in the range table
 * @property {string} label
 * @property {string} value as the prompt writes it, with its words for a value not measured
 * @property {string} range as the prompt words it
 * @property {boolean} miss
 */

/**
 * @param {Features} features the excerpt's
 * @param {FeatureRanges} ranges validated, as the brief version stores them
 * @returns {{ rows: RangeRow[], misses: number, text: string }}
 */
export function rangesReadout(features, ranges) {
  const missed = new Set(checkTargets(features, ranges).findings.map(({ path }) => path));
  const rows = Object.entries(TARGET_FEATURES).flatMap(([name, { feature }]) => {
    const range = ranges[name];
    if (range === undefined) return [];
    const value = featureValue(features, feature);
    const shown = value === null ? null : roundFeature(value, feature.digits);
    return [
      {
        name,
        label: feature.label,
        value: featureText(shown, feature.digits, feature.unit),
        range: rangeWords(range, feature.unit),
        miss: missed.has(`${RANGES_KEY}.${name}`),
      },
    ];
  });
  const misses = rows.filter((row) => row.miss).length;
  const text =
    rows.length === 0
      ? "The brief sets no ranges to aim for."
      : misses === 0
        ? `Inside all ${rows.length} of the brief's ranges.`
        : `Misses ${misses} of the brief's ${rows.length} range${rows.length === 1 ? "" : "s"}.`;
  return { rows, misses, text };
}

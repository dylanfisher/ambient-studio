// A card's features against its brief's ranges (decision 0039), one row per range with each
// miss marked, and the render checks it fails. The misses are `excerptMisses`'s, so the card
// counts what the revision pass and the shown-card rule count (0036), at the prompt's rounding.
// No DOM.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
import { excerptMisses } from "../domain/excerpt-misses.js";
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
 * @param {LintResult} checks the excerpt's render checks
 * @returns {{ rows: RangeRow[], failed: string[], misses: number, text: string }} `failed`
 *   names each failed check's rule; `misses` counts ranges missed and checks failed
 */
export function rangesReadout(features, ranges, checks) {
  const misses = excerptMisses(features, checks, ranges);
  const missedPaths = new Set(misses.map(({ path }) => path));
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
        miss: missedPaths.has(`${RANGES_KEY}.${name}`),
      },
    ];
  });
  const missed = rows.filter((row) => row.miss).length;
  const failed = checks.findings.map(({ rule }) => rule);
  const rangesText =
    rows.length === 0
      ? "The brief sets no ranges to aim for."
      : missed === 0
        ? `Inside all ${rows.length} of the brief's ranges.`
        : `Misses ${missed} of the brief's ${rows.length} range${rows.length === 1 ? "" : "s"}.`;
  const checksText =
    failed.length === 0
      ? ""
      : ` Fails ${failed.length} render check${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}.`;
  return { rows, failed, misses: misses.length, text: rangesText + checksText };
}

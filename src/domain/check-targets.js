// An excerpt's features against a vibe's ranges (decision 0034), returned as the linter's
// result type (0020) so the revision ask (3d) quotes a miss the way the repair quotes a finding.
/** @import { Features } from "./extract-features.js" */
/** @import { Finding, LintResult } from "./lint-result.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
import { featureValue } from "./feature-names.js";
import { lintResult } from "./lint-result.js";
import { RANGES_KEY, rangeWords, TARGET_FEATURES } from "./target-schema.js";

/** The rule of every finding here. */
const TARGET_RULE = "target";

/**
 * One finding for each range the features miss, in the table's order, with path
 * `features.<name>` and rule `target`. A value is compared at the digits `featuresText` writes,
 * so a miss is one the model can read in the prompt. A value that couldn't be measured is a
 * miss.
 * @param {Features} features
 * @param {FeatureRanges} ranges validated, as `validateTargets` returns them
 * @returns {LintResult}
 */
export function checkTargets(features, ranges) {
  /** @type {Finding[]} */
  const findings = [];
  for (const [name, { feature }] of Object.entries(TARGET_FEATURES)) {
    const range = ranges[name];
    if (range === undefined) continue;
    const value = featureValue(features, feature);
    const shown = value === null ? null : Number(value.toFixed(feature.digits));
    const [low, high] = range;
    if (shown !== null && (low === null || shown >= low) && (high === null || shown <= high)) {
      continue;
    }
    const what =
      shown === null
        ? `${feature.label} couldn't be measured`
        : `${feature.label} is ${shown.toFixed(feature.digits)}${feature.unit ? ` ${feature.unit}` : ""}`;
    findings.push({
      path: `${RANGES_KEY}.${name}`,
      rule: TARGET_RULE,
      message: `${what}; the vibe asks for a value ${rangeWords(range, feature.unit)}`,
    });
  }
  return lintResult(findings);
}

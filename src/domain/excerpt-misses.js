// What a rendered excerpt misses (decision 0036): each range its features miss (0034), then each
// render check it fails (0023). A candidate with any gets a revision, and the session shows the
// one of a pair with fewer.
/** @import { Features } from "./extract-features.js" */
/** @import { Finding, LintResult } from "./lint-result.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
import { checkTargets } from "./check-targets.js";

/**
 * @param {Features} features
 * @param {LintResult} checks the render's checks
 * @param {FeatureRanges} ranges validated, as `validateTargets` returns them
 * @returns {Finding[]}
 */
export const excerptMisses = (features, checks, ranges) => [
  ...checkTargets(features, ranges).findings,
  ...checks.findings,
];

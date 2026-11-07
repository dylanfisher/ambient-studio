// A vibe's feature ranges as lines of the prompt (decision 0034). Every first prompt carries
// them, and the revision ask (3d) quotes them, so the model reads one wording of a range.
/** @import { FeatureRanges } from "./target-schema.js" */
import { rangeWords, TARGET_FEATURES } from "./target-schema.js";

/**
 * A header line, then one line for each range the vibe gives, in the table's order; "" when it
 * gives none, so the prompt leaves the section out.
 * @param {FeatureRanges} ranges validated, as `validateTargets` returns them
 * @returns {string}
 */
export function targetsText(ranges) {
  const lines = Object.entries(TARGET_FEATURES).flatMap(([name, { feature }]) => {
    const range = ranges[name];
    return range === undefined ? [] : [`${feature.label} ${rangeWords(range, feature.unit)}`];
  });
  if (lines.length === 0) return "";
  return [
    "Feature ranges the vibe aims for, measured on each excerpt after it is normalized; a genome outside one is kept, but aim inside every one:",
    ...lines,
  ].join("\n");
}

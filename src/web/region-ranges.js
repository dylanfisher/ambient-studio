// "Set ranges from a region" on the brief page (decision 0051): the form's values for the
// ranges a region proposes, and beside each one what the brief has saved now. No DOM and no
// request here: filling the form saves nothing, and the owner's Save is the only write.
/** @import { RegionFields } from "../domain/reference-region.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
import { rangeWords, TARGET_FEATURES } from "../domain/target-schema.js";
import { formatSeconds } from "./region-form.js";
import { targetValues } from "./target-fields.js";

/**
 * The inputs to set for `proposed`, named as `readTargets` reads them, and for each feature it
 * names, a sentence saying what is saved now. A feature the proposal leaves out keeps whatever
 * the form holds.
 * @param {FeatureRanges} proposed from `rangesFromRegion`
 * @param {FeatureRanges} saved the current revision's ranges
 * @returns {{ values: Record<string, string>, beside: Record<string, string> }}
 */
export function rangeFill(proposed, saved) {
  /** @type {Record<string, string>} */
  const beside = {};
  for (const name of Object.keys(proposed)) {
    const range = saved[name];
    const unit = TARGET_FEATURES[name]?.feature.unit ?? null;
    beside[name] = `Saved now: ${range ? rangeWords(range, unit) : "no range"}.`;
  }
  return { values: targetValues(proposed), beside };
}

/**
 * A region as the brief page's list of regions names it.
 * @param {RegionFields} region
 * @param {string} fileName the recording's
 */
export const regionChoiceText = ({ startSeconds, endSeconds, label }, fileName) =>
  `${fileName}: ${label}, ${formatSeconds(startSeconds)} to ${formatSeconds(endSeconds)}`;

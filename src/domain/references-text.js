// The reference regions attached to a vibe as a section of the first prompt (decision 0052):
// each region's label and note as the owner wrote them, its median features over its windows,
// and the words nearest its sound by CLAP similarity. It follows the ranges, which are measured
// the same way, so the model reads both as numbers to aim at.
/** @import { Features } from "./extract-features.js" */
/** @import { FeatureName } from "./feature-names.js" */
import { featureValue } from "./feature-names.js";
import { featureEntryText } from "./features-text.js";
import { percentiles } from "./percentiles.js";
import { windowsText } from "./region-windows.js";
import { TARGET_FEATURES } from "./target-schema.js";

/**
 * A region attached to the vibe, as the prompt reads it.
 * @typedef {object} PromptReference
 * @property {number} id the attachment's row id, logged with the generation
 * @property {string} label
 * @property {string} note "" for none
 * @property {readonly Features[]} windows the region's windows at the vibe's loudness, at least
 *   one
 * @property {readonly string[]} words nearest first; empty when the region's sound has no
 *   embedding under the sidecar's checkpoint
 */

const HEADER =
  "Parts of reference recordings the owner attached to this vibe, measured the way the ranges are. Aim at their measurements; don't copy the recordings, which the engine can't play:";

/**
 * Owner text as a JSON string. U+2028 and U+2029 are escaped too, which `JSON.stringify` leaves
 * as they are, so the text stays on its one line however a reader splits lines.
 * @param {string} text
 */
export const quoted = (text) =>
  JSON.stringify(text).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

/**
 * The median by nearest rank of one feature over the windows that measured it, so it is a
 * value a window read, as `rangesFromRegion`'s ends are; null when none did.
 * @param {readonly Features[]} windows
 * @param {FeatureName} entry
 */
function median(windows, entry) {
  const values = windows
    .map((features) => featureValue(features, entry))
    .filter((value) => value !== null);
  return values.length === 0 ? null : percentiles(values).p50;
}

/**
 * @param {PromptReference} reference
 * @param {number} index from 0
 * @returns {string[]}
 */
function referenceLines({ label, note, windows, words }, index) {
  // The range table's features: a recording's own level says nothing a genome can match (0051).
  const medians = Object.values(TARGET_FEATURES)
    .map(({ feature }) => featureEntryText(feature, median(windows, feature)))
    .join(", ");
  return [
    `Reference ${index + 1}, its label as a JSON string: ${quoted(label)}`,
    ...(note === "" ? [] : [`Its note, as a JSON string: ${quoted(note)}`]),
    `Medians over its ${windowsText(windows.length)}: ${medians}`,
    ...(words.length === 0 ? [] : [`Words nearest its sound: ${words.join(", ")}`]),
  ];
}

/**
 * The section, or "" when no region is attached, so the prompt leaves it out.
 * @param {readonly PromptReference[]} references
 * @returns {string}
 */
export function referencesText(references) {
  if (references.length === 0) return "";
  return [HEADER, ...references.flatMap(referenceLines)].join("\n");
}

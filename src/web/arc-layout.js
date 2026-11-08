// The arc target under the timeline (decision 0066), with no DOM: an attached reference region's
// per-window features (0051) stretched to the track's length, so each window sits at its share
// of the region on the track, beside each section's measured features, and both placed by
// height on one scale for the feature chosen. `material-card.js` draws it.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { FeatureName } from "../domain/feature-names.js" */
/** @import { Span } from "./timeline-layout.js" */
import { featureText, featureValue } from "../domain/feature-names.js";
import { clockTime } from "./excerpt-player.js";
import { span } from "./timeline-layout.js";

/** What the arc says when no section has been measured. */
export const ARC_UNMEASURED =
  "No section has been measured yet. Play a section to measure its sound, and it is drawn here beside the region.";

/**
 * One window of a region's analysis as the analysis route gives it.
 * @typedef {{ startSeconds: number, seconds: number, features: Features }} ArcWindow
 */

/**
 * A mark on the arc: its span of the track, its value, its height in percent from the top (null
 * when it has no value), and its title.
 * @typedef {{ span: Span, value: number | null, top: number | null, title: string }} ArcMark
 */

/**
 * @param {object} drawn
 * @param {number} drawn.length the track's, in seconds
 * @param {readonly ArcWindow[]} drawn.windows the region's, in order
 * @param {readonly Span[]} drawn.blocks each section's span, as `timelineLayout` gives them
 * @param {readonly (Features | null)[]} drawn.measures each section's measured features, null
 *   while it hasn't been measured
 * @param {FeatureName} drawn.feature the one drawn
 * @returns {{ windows: ArcMark[], sections: ArcMark[], line: string }}
 */
export function arcLayout({ length, windows, blocks, measures, feature }) {
  if (!(length > 0)) {
    return {
      windows: [],
      sections: [],
      line: "Add a section: the region is stretched over the track's length.",
    };
  }
  const { label, digits, unit } = feature;
  const said = (/** @type {number | null} */ value) =>
    `${label} ${featureText(value, digits, unit)}`;
  const regionLength = Math.max(
    ...windows.map(({ startSeconds, seconds }) => startSeconds + seconds),
  );
  const stretch = length / regionLength;
  const windowValues = windows.map(({ features }) => featureValue(features, feature));
  const sectionValues = blocks.map((_, i) => {
    const measured = measures[i];
    return measured ? featureValue(measured, feature) : null;
  });
  const values = [...windowValues, ...sectionValues].filter((value) => value !== null);
  const low = Math.min(...values);
  const high = Math.max(...values);
  /** @param {number | null} value */
  const top = (value) =>
    value === null
      ? null
      : high === low
        ? 50
        : Math.round((1 - (value - low) / (high - low)) * 100);
  const marks = windows.map(({ startSeconds, seconds }, i) => {
    const at = span(startSeconds * stretch, (startSeconds + seconds) * stretch, length);
    const value = /** @type {number | null} */ (windowValues[i]);
    return {
      span: at,
      value,
      top: top(value),
      title: `The region from ${clockTime(startSeconds)} to ${clockTime(startSeconds + seconds)}, at ${clockTime(at.start)} to ${clockTime(at.end)} of the track: ${said(value)}.`,
    };
  });
  const sections = blocks.map((block, i) => {
    const value = /** @type {number | null} */ (sectionValues[i]);
    const measured = measures[i] ? said(value) : "not measured yet";
    return { span: block, value, top: top(value), title: `Section ${i + 1}: ${measured}.` };
  });
  const measured = measures.filter(Boolean).length;
  const range =
    values.length === 0
      ? `${label}: none measurable.`
      : `${label}, from ${featureText(low, digits, unit)} to ${featureText(high, digits, unit)}.`;
  const count =
    measured === 0
      ? ARC_UNMEASURED
      : measured === blocks.length
        ? "Every section is measured."
        : `${measured} of ${blocks.length} sections measured; play the others to measure them.`;
  return {
    windows: marks,
    sections,
    line: `${range.charAt(0).toUpperCase()}${range.slice(1)} ${count}`,
  };
}

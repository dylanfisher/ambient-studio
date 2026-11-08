// A brief's ranges proposed from a reference region's windows (decision 0051): the 10th to the
// 90th percentile of each feature over the windows, widened to a minimum width and kept inside
// 0034's bounds. Only features in 0034's range table are proposed, so the two raw levels never
// are: a mastered recording's level says nothing a genome can match.
/** @import { Features } from "./extract-features.js" */
/** @import { FeatureRanges, TargetFeature } from "./target-schema.js" */
import { featureValue } from "./feature-names.js";
import { TARGET_FEATURES } from "./target-schema.js";

/** The percentiles a proposed range runs between, by nearest rank. */
const PERCENTILES = Object.freeze({ low: 10, high: 90 });

/**
 * The narrowest range proposed per feature, in its unit, each set against 0034's calibration
 * spread in 0051's table. A region whose windows all read alike would otherwise propose a range
 * too narrow for a candidate to land in.
 * @type {Readonly<Record<string, number>>}
 */
export const MIN_RANGE_WIDTH = Object.freeze({
  loudnessRange: 2,
  centroidMean: 100,
  centroidSpread: 20,
  onsetRate: 0.1,
  lowEndShare: 0.1,
  stereoWidth: 0.04,
  flatness: 0.05,
});

/** Slack for the float error in `value * 10 ** digits`, so 0.29 isn't floored to 0.28. */
const ROUNDING_SLACK = 1e-9;

/**
 * Nearest rank, as `percentiles` takes it, so each end is a value a window measured.
 * @param {readonly number[]} sorted ascending, at least one
 * @param {number} p
 */
const rank = (sorted, p) =>
  /** @type {number} */ (sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]);

/**
 * Widens `[low, high]` about its middle to `width`, then moves it inside the bounds, keeping
 * the width where the bounds leave room.
 * @param {number} low
 * @param {number} high
 * @param {number} width
 * @param {TargetFeature} bounds
 * @returns {[number, number]}
 */
function widened(low, high, width, { least, most }) {
  let [from, to] = [low, high];
  if (to - from < width) {
    const middle = (from + to) / 2;
    [from, to] = [middle - width / 2, middle + width / 2];
  }
  if (from < least) [from, to] = [least, Math.max(to, least + width)];
  if (most !== null && to > most)
    [from, to] = [Math.max(least, Math.min(from, most - width)), most];
  return [from, to];
}

/**
 * The ranges a region's windows propose, in the range table's order. A feature no window could
 * measure is left out; the others are read from the windows that measured them.
 * @param {readonly Features[]} windows each window's features
 * @returns {FeatureRanges}
 */
export function rangesFromRegion(windows) {
  if (windows.length === 0) throw new Error("a region with no windows proposes no ranges");
  /** @type {FeatureRanges} */
  const ranges = {};
  for (const [name, target] of Object.entries(TARGET_FEATURES)) {
    const values = windows
      .map((features) => featureValue(features, target.feature))
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    if (values.length === 0) continue;
    const width = MIN_RANGE_WIDTH[name];
    if (width === undefined) throw new Error(`MIN_RANGE_WIDTH has no width for ${name}`);
    const [from, to] = widened(
      rank(values, PERCENTILES.low),
      rank(values, PERCENTILES.high),
      width,
      target,
    );
    // Outward, to the digits the prompt and the checks round to, so rounding never narrows it.
    const scale = 10 ** target.feature.digits;
    ranges[name] = [
      Math.floor(from * scale + ROUNDING_SLACK) / scale,
      Math.ceil(to * scale - ROUNDING_SLACK) / scale,
    ];
  }
  return ranges;
}

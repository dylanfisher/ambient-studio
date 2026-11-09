// A candidate's ranged features against the rest of its brief, in words (decision 0085, plan
// WF acceptance 2): "brighter than most of this brief". The reference is the brief's other
// measured excerpts; each value is compared at the rounding the prompt writes, so excerpts that
// read the same to the model tie. Only features above or below most of the others are named.
/** @import { Features } from "./extract-features.js" */
import { featureValue } from "./feature-names.js";
import { MIN_OTHERS, PLACE_SIDE, placeOf, shareBelow } from "./place-words.js";
import { TARGET_FEATURES } from "./target-schema.js";

/**
 * What more and less of each ranged feature sound like, as words that follow "it is" or "it".
 * A ranged feature with no words here fails the test.
 * @type {Readonly<Record<string, { more: string, less: string }>>}
 */
export const FEATURE_WAYS = Object.freeze({
  loudnessRange: { more: "swells and recedes more", less: "is steadier in level" },
  centroidMean: { more: "is brighter", less: "is darker" },
  centroidSpread: { more: "changes its tone more", less: "keeps its tone steadier" },
  onsetRate: {
    more: "is busier, with notes starting more often",
    less: "is calmer, with fewer notes starting",
  },
  lowEndShare: { more: "is heavier in the low end", less: "is lighter in the low end" },
  stereoWidth: { more: "is wider", less: "is narrower" },
  flatness: { more: "is noisier", less: "is more tonal" },
});

/**
 * @param {Features} features
 * @param {import("./feature-names.js").FeatureName} entry
 */
function rounded(features, entry) {
  const value = featureValue(features, entry);
  return value === null ? null : Number(value.toFixed(entry.digits));
}

/**
 * One line saying which features sit high or low among the brief's other excerpts.
 * @param {Features} features the candidate's excerpt's
 * @param {readonly Features[]} others the brief's other excerpts', its own left out
 * @returns {string}
 */
export function featureWords(features, others) {
  if (features.heard === null) {
    return "Too quiet to hear once normalized, so it isn't compared with the rest of this brief.";
  }
  /** @type {string[]} */
  const named = [];
  let compared = 0;
  for (const [name, { feature }] of Object.entries(TARGET_FEATURES)) {
    const ways = FEATURE_WAYS[name];
    if (!ways) throw new Error(`no words for the feature ${name}`);
    const value = rounded(features, feature);
    const values = others.flatMap((other) => {
      const at = rounded(other, feature);
      return at === null ? [] : [at];
    });
    if (value === null || values.length < MIN_OTHERS) continue;
    compared += 1;
    const { side, degree } = placeOf(shareBelow(value, values));
    if (side !== null)
      named.push(`${side === PLACE_SIDE.above ? ways.more : ways.less} than ${degree}`);
  }
  if (compared === 0) {
    return "This brief has too few other measured excerpts to compare it with yet.";
  }
  if (named.length === 0) return "About the middle of this brief on every measure.";
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `Against the rest of this brief, it ${list}; the rest sit about the middle.`;
}

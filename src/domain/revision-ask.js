// The revision's ask (decision 0036): the user turn that follows a valid first try whose excerpt
// missed a feature range or failed a render check. It restates the vibe's current locks and its
// ranges, gives the excerpt's measured features and each miss, and asks for one revision, or the
// genome unchanged when it already fits. The control arm's ask is the same without the
// measurements.
/** @import { Features } from "./extract-features.js" */
/** @import { Finding } from "./lint-result.js" */
/** @import { FeatureRanges } from "./target-schema.js" */
/** @import { Lock } from "./validate-lock.js" */
import { ANSWER_FORMAT, locksText } from "./build-prompt.js";
import { quotedErrors } from "./build-repair-prompt.js";
import { featuresText } from "./features-text.js";
import { targetsText } from "./targets-text.js";

/**
 * @typedef {object} RevisionTerms
 * @property {readonly Lock[]} locks the vibe's locks in force now, which may differ from the
 *   first prompt's
 * @property {FeatureRanges} ranges
 * @property {Features} features the first try's excerpt, measured
 * @property {readonly Finding[]} misses from `excerptMisses`, at least one
 */

/** The last line of both arms' asks, so either may answer unchanged. */
const UNCHANGED = "If the genome already fits the vibe as it is, answer with it unchanged.";

/**
 * The ask's parts in order; only the opening, the measured part and the request differ between
 * the treatment and the control (decision 0040).
 * @param {{ locks: readonly Lock[], ranges: FeatureRanges }} terms
 * @param {{ opening: string, measured: string[], request: string }} wording
 */
function followUpAsk({ locks, ranges }, { opening, measured, request }) {
  const targets = targetsText(ranges);
  return [
    opening,
    ...locksText(locks),
    ...(targets === "" ? [] : [targets]),
    ...measured,
    [
      `${request}, keeping every locked value, and answer with the whole revised object, and nothing else: ${ANSWER_FORMAT}`,
      UNCHANGED,
    ].join("\n"),
  ].join("\n\n");
}

/**
 * @param {RevisionTerms} terms
 * @returns {string}
 */
export function revisionAsk({ locks, ranges, features, misses }) {
  if (misses.length === 0) throw new Error("a revision needs at least one miss to quote");
  return followUpAsk(
    { locks, ranges },
    {
      opening: "Your genome was rendered, and its excerpt measured.",
      measured: [
        `Measured on the excerpt: ${featuresText(features)}`,
        [
          "The excerpt misses these. A features path is a measurement; any other starts at the genome.",
          ...quotedErrors(misses),
        ].join("\n"),
      ],
      request: "Revise the genome once so its excerpt fits the vibe",
    },
  );
}

/**
 * The control arm's ask (decision 0040): the treatment's with the measured line and the misses
 * taken out, asking for a better fit to the brief, so the evaluation measures what the
 * measurements add over asking again.
 * @param {{ locks: readonly Lock[], ranges: FeatureRanges }} terms
 * @returns {string}
 */
export function controlAsk(terms) {
  return followUpAsk(terms, {
    opening: "Your genome was rendered.",
    measured: [],
    request: "Revise the genome once so its excerpt fits the brief and the ranges better",
  });
}

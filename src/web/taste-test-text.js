// The taste model test's report in plain words (decisions 0032 and 0045). No DOM here, so the
// wording is tested. The report is the server's `PreferenceTestReport`, read as JSON.
import { PREFERENCE_MINIMUM } from "../domain/preference-minimum.js";

const NEEDS = `${PREFERENCE_MINIMUM.pairs} A/B choices over at least ${PREFERENCE_MINIMUM.sessions} sessions`;

/** @param {number} share from 0 to 1 */
const percent = (share) => `${Math.round(share * 100)}%`;

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * One predictor's agreement, such as `71% of 41, probably between 50% and 86%`.
 * @param {{ agreement: { share: number, scored: number, low: number, high: number } | null,
 *   unscored: number }} result
 */
export function agreementText({ agreement, unscored }) {
  if (agreement === null) {
    return unscored > 0
      ? `no model yet: it couldn't tell any of the ${unscored} apart`
      : "nothing to score";
  }
  const { share, scored, low, high } = agreement;
  return `${percent(share)} of ${scored}, probably between ${percent(low)} and ${percent(high)}`;
}

/** @param {number} n */
const areLeftOut = (n) => `${n} more ${n === 1 ? "is" : "are"} left out`;

/**
 * The ratings a brief's test couldn't use, or "" for none.
 * @param {any} vibe
 */
function leftOutText({ noFeatures, noSound }) {
  const parts = [];
  if (noSound)
    parts.push(`${areLeftOut(noSound)} until their sound is analyzed (run the embed job)`);
  if (noFeatures) {
    const lead = parts.length === 0 ? areLeftOut(noFeatures) : String(noFeatures);
    parts.push(`${lead} because they were heard under an older engine`);
  }
  return parts.length === 0 ? "" : ` ${parts.join(", and ")}.`;
}

/**
 * What a brief's test found, in a sentence or two.
 * @param {any} vibe one of the report's `vibes`
 */
export function tasteSummary(vibe) {
  const { pairs, thumbs, sessions, shortfall, test } = vibe;
  if (shortfall !== null) {
    if (pairs === 0) {
      return thumbs === 0
        ? `Not enough data: no ratings yet, so there is no model yet. The test needs ${NEEDS}.`
        : `Not enough data: ${thumbs} thumbs but no A/B choices, and the test scores A/B choices. It needs ${NEEDS}.${leftOutText(vibe)}`;
    }
    const more = [];
    if (shortfall.pairs > 0) more.push(`${shortfall.pairs} more`);
    if (shortfall.sessions > 0) {
      more.push(
        `${shortfall.pairs > 0 ? "over " : ""}at least ${plural(shortfall.sessions, "more session", "more sessions")}`,
      );
    }
    return `Not enough data: ${plural(pairs, "A/B choice", "A/B choices")} over ${plural(sessions, "session", "sessions")}. It needs ${more.join(", ")}.${leftOutText(vibe)}`;
  }
  const { agreement } = test.model;
  if (agreement === null) {
    return `There is no model to test yet: ${agreementText(test.model)}.`;
  }
  return `On sessions it hadn't learned from, the model picked your choice ${percent(agreement.share)} of the time (${agreement.agreed} of ${agreement.scored}), probably between ${percent(agreement.low)} and ${percent(agreement.high)}.`;
}

/**
 * A tested brief's facts as term and value, the model first, then the baselines it is
 * compared with.
 * @param {any} vibe
 * @returns {[string, string][]}
 */
export function tasteFacts({ test }) {
  if (test === null) return [];
  return [
    ["The model", agreementText(test.model)],
    ["Features only, without the sound analysis", agreementText(test.featuresOnly)],
    ["Always the left one", agreementText(test.alwaysLeft)],
    ["The louder one", agreementText(test.louder)],
    [
      "Left out",
      `${test.ties} about the same; ${test.leaked} whose candidate was also rated in another session`,
    ],
  ];
}

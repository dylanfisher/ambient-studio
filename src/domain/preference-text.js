// What a vibe's taste model says the owner likes, written by a template from its weights, never
// by the LLM (decision 0047). Only a feature or macro weight whose 95% interval excludes zero is
// named, by its direction alone, since every column is standardized and a weight has no unit.
// The CLAP components have no names, so the text gives only their share of the weights.
import { FEATURE_NAMES } from "./feature-names.js";
import { macroVerb, macroWords } from "./macro-words.js";
import { PAIR_NOUN, shortfall } from "./preference-minimum.js";

/** A 95% interval is the mean ± this many standard deviations. */
const Z_95 = 1.96;
/** The most phrases the text names, clearest first. */
const SHOWN_PHRASES = 4;

/** What the server found for a vibe's taste model. */
export const PREFERENCE_STATE = Object.freeze({ none: "none", stale: "stale", fitted: "fitted" });

const HOW_TO_FIT =
  "To fit one, press Analyze the sound and then Fit the taste model on the Model test page.";

/**
 * The fields of a model file (decision 0044) the text reads.
 * @typedef {object} ModelWeights
 * @property {string[]} featureNames
 * @property {string[]} macroNames
 * @property {string[]} terms `clap:<k>`, `feature:<name>`, `macro:<name>`, then the bias and
 *   the thumbs intercept
 * @property {number[]} mean the posterior mean, one per term
 * @property {number[][]} covariance the posterior covariance
 * @property {{ featureScales: number[], macroScales: number[] }} basis a scale of 0 marks a
 *   column with one value throughout, whose term is 0 for every item
 */

/**
 * What the server found for a vibe: no model, with the reason when one is known; a model file
 * missing under the vibe's current key; or the current model with the A/B ratings it was fitted
 * on (a tie counted once) and the sessions they came from.
 * @typedef {{ state: typeof PREFERENCE_STATE.none, reason: string | null }
 *   | { state: typeof PREFERENCE_STATE.stale }
 *   | { state: typeof PREFERENCE_STATE.fitted, model: ModelWeights, pairs: number,
 *     sessions: number }} PreferenceState
 */

/**
 * @param {number} n
 * @param {string} word
 */
const counted = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "a", "a and b", "a, b, and c".
 * @param {string[]} parts
 */
function listed(parts) {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/**
 * A term's words for more of it and less of it, or null for a column the basis found constant,
 * whose weight learns nothing.
 * @param {ModelWeights} model
 * @param {string} term
 * @returns {{ more: string, less: string } | null}
 */
function termWords(model, term) {
  const [kind, name = ""] = term.split(":");
  if (kind === "feature") {
    const index = model.featureNames.indexOf(name);
    const label = FEATURE_NAMES.find((entry) => entry.name === name)?.label;
    if (index < 0 || label === undefined) throw new Error(`no words for the model term ${term}`);
    if (model.basis.featureScales[index] === 0) return null;
    return { more: `to have the ${label} higher`, less: `to have the ${label} lower` };
  }
  const index = model.macroNames.indexOf(name);
  if (index < 0) throw new Error(`no words for the model term ${term}`);
  if (model.basis.macroScales[index] === 0) return null;
  const { more, less } = macroWords(name);
  return { more: `to ${macroVerb(more)}`, less: `to ${macroVerb(less)}` };
}

/**
 * The text for the brief page.
 * @param {PreferenceState} found
 * @returns {{ text: string }}
 */
export function preferenceText(found) {
  if (found.state === PREFERENCE_STATE.stale) {
    return {
      text: "The taste model is out of date: ratings or the sound analysis have changed since it was fitted, so it isn't shown. Press Fit the taste model on the Model test page to update it.",
    };
  }
  if (found.state === PREFERENCE_STATE.none) {
    return {
      text: `No taste model yet${found.reason === null ? "" : `: ${found.reason}`}. ${HOW_TO_FIT}`,
    };
  }
  const { model, pairs, sessions } = found;
  /** @type {number[]} */
  const clap = [];
  /** @type {{ words: { more: string, less: string }, mean: number, sd: number }[]} */
  const named = [];
  for (const [i, term] of model.terms.entries()) {
    const mean = /** @type {number} */ (model.mean[i]);
    const sd = Math.sqrt(/** @type {number} */ (model.covariance[i]?.[i]));
    if (term.startsWith("clap:")) clap.push(mean);
    if (!term.startsWith("feature:") && !term.startsWith("macro:")) continue;
    const words = termWords(model, term);
    if (words !== null) named.push({ words, mean, sd });
  }
  if (clap.length === 0 && named.length === 0) {
    return preferenceText({ state: PREFERENCE_STATE.none, reason: null });
  }

  const rests = `${counted(pairs, PAIR_NOUN)} over ${counted(sessions, "session")}`;
  const more = shortfall(pairs, sessions);
  if (more !== null) {
    const needs = [
      more.pairs > 0 ? counted(more.pairs, `more ${PAIR_NOUN}`) : "",
      more.sessions > 0 ? counted(more.sessions, "more session") : "",
    ].filter((part) => part !== "");
    return {
      text: `Not enough data yet: the taste model rests on ${rests}, and needs ${listed(needs)} before it says what you like.`,
    };
  }

  const clear = named
    .filter(({ mean, sd }) => Math.abs(mean) > Z_95 * sd)
    .sort((a, b) => Math.abs(b.mean) / b.sd - Math.abs(a.mean) / a.sd);
  const phrases = clear
    .slice(0, SHOWN_PHRASES)
    .map(({ words, mean }) => (mean > 0 ? words.more : words.less));
  const likes =
    phrases.length === 0
      ? `From ${rests}, no measured feature or macro clearly matters yet.`
      : `From ${rests}, you prefer candidates ${listed(phrases)}${clear.length > SHOWN_PHRASES ? ` (the ${SHOWN_PHRASES} clearest of ${clear.length})` : ""}.`;
  // Each term has unit variance over the basis items, so a weight's square is about its share of
  // the score's spread; correlation between terms is ignored (decision 0047).
  /** @param {number[]} weights */
  const squares = (weights) => weights.reduce((sum, w) => sum + w * w, 0);
  const total = squares(clap) + squares(named.map(({ mean }) => mean));
  const sound =
    clap.length === 0 || total === 0
      ? ""
      : ` About ${Math.round((100 * squares(clap)) / total)}% of the model's weight is on the sound itself, which the features and macros don't name.`;
  return { text: likes + sound };
}

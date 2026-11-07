// A vibe's training set for the preference model (decision 0043): A/B ratings as pairs, a tie as
// half a win each way, and thumbs as pointwise items. Each side is named by its rated audio, the
// excerpt as the owner heard it, and carries its features and its macros over the heard window.
/** @import { Features } from "./extract-features.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
import { MACROS } from "../engine/genome-schema.js";
import { requireGenome } from "../engine/validate-genome.js";
import { FEATURE_NAMES, featureValue } from "./feature-names.js";
import { macroWindow } from "./macro-window.js";
import { FEEDBACK_KIND, OUTCOMES, THUMBS } from "./rating-values.js";

/**
 * What the set reads of one heard excerpt, on a rating side or a feedback row.
 * @typedef {object} HeardInput
 * @property {number} ratedAudioId
 * @property {number} genomeId
 * @property {number} offset timeline seconds
 * @property {number} duration seconds
 */

/**
 * The fields of a stored A/B rating the set reads.
 * @typedef {object} RatingInput
 * @property {number} id
 * @property {number} sessionId
 * @property {HeardInput} a
 * @property {HeardInput} b
 * @property {"a" | "b"} leftSide
 * @property {string} outcome `a`, `b`, `tie` or `skip`
 * @property {number | null} removedAt
 */

/**
 * The fields of a stored feedback row the set reads.
 * @typedef {HeardInput & {
 *   id: number,
 *   sessionId: number,
 *   kind: string,
 *   direction: string,
 *   removedAt: number | null,
 * }} FeedbackInput
 */

/**
 * One heard excerpt as the fit sees it.
 * @typedef {object} Item
 * @property {number} ratedAudioId what 4b embeds
 * @property {number} genomeId the candidate, for the fold's leak rule
 * @property {Record<string, number | null>} features each of `FEATURE_NAMES` by name, in its
 *   order; null where the excerpt had nothing to measure
 * @property {Record<MacroName, number>} macros each macro's mean over the heard window
 */

/**
 * The winner beat the loser with this weight: 1 for a win, 0.5 for each half of a tie.
 * @typedef {object} Pair
 * @property {number} ratingId
 * @property {number} sessionId
 * @property {Item} winner
 * @property {Item} loser
 * @property {number} weight
 * @property {boolean} tie agreement leaves ties out
 * @property {boolean} winnerLeft the winner was shown on the left
 */

/**
 * @typedef {object} Thumb
 * @property {number} feedbackId
 * @property {number} sessionId
 * @property {Item} item
 * @property {boolean} up
 */

/**
 * A rating or thumbs left out of the set because an excerpt it names has no features: one entry
 * for each such excerpt.
 * @typedef {({ ratingId: number } | { feedbackId: number }) & { ratedAudioId: number }} Missing
 */

/**
 * @typedef {object} TrainingSet
 * @property {Pair[]} pairs by rating id, the two halves of a tie together
 * @property {Thumb[]} thumbs by feedback id
 * @property {Missing[]} missing the ratings by id, then the thumbs by id
 */

const MACRO_NAMES = /** @type {MacroName[]} */ (Object.keys(MACROS));
const TIE_WEIGHT = 0.5;

/** @param {{ id: number }} x @param {{ id: number }} y */
const byId = (x, y) => x.id - y.id;

/**
 * @param {object} input
 * @param {readonly RatingInput[]} input.ratings the vibe's A/B ratings; removed ones and skips
 *   are left out here
 * @param {readonly FeedbackInput[]} input.feedback the vibe's feedback; only live thumbs are used
 * @param {ReadonlyMap<number, unknown>} input.genomes every genome the rows name, by id
 * @param {ReadonlyMap<number, Features>} input.features features measured on each rated audio,
 *   by id; an id left out is reported in `missing`
 * @returns {TrainingSet}
 */
export function buildTrainingSet({ ratings, feedback, genomes, features }) {
  /** @type {Map<number, Genome>} */
  const normalized = new Map();
  /** @type {Missing[]} */
  const missing = [];

  /**
   * @param {HeardInput} heard
   * @param {string} row names the row in an error
   * @returns {Item | null} null when the excerpt has no features
   */
  function item({ ratedAudioId, genomeId, offset, duration }, row) {
    let genome = normalized.get(genomeId);
    if (!genome) {
      if (!genomes.has(genomeId)) {
        throw new Error(`${row} names genome ${genomeId}, which wasn't given`);
      }
      genome = requireGenome(genomes.get(genomeId), `${row}'s genome ${genomeId} is invalid`);
      normalized.set(genomeId, genome);
    }
    const measured = features.get(ratedAudioId);
    if (!measured) return null;
    return {
      ratedAudioId,
      genomeId,
      features: Object.fromEntries(
        FEATURE_NAMES.map((entry) => [entry.name, featureValue(measured, entry)]),
      ),
      macros: /** @type {Record<MacroName, number>} */ (
        Object.fromEntries(
          MACRO_NAMES.map((macro) => [macro, macroWindow(genome, macro, offset, duration).mean]),
        )
      ),
    };
  }

  /** @type {Pair[]} */
  const pairs = [];
  for (const { id, outcome } of ratings) {
    if (!OUTCOMES.some((known) => known === outcome)) {
      throw new Error(`rating ${id} has outcome ${JSON.stringify(outcome)}`);
    }
  }
  // Every outcome but a win or a tie is a skip, which says nothing about either side.
  const counted = (/** @type {string} */ outcome) =>
    outcome === "a" || outcome === "b" || outcome === "tie";
  const rated = ratings.filter((r) => r.removedAt === null && counted(r.outcome));
  for (const rating of [...rated].sort(byId)) {
    const row = `rating ${rating.id}`;
    const a = item(rating.a, row);
    const b = item(rating.b, row);
    if (!a) missing.push({ ratingId: rating.id, ratedAudioId: rating.a.ratedAudioId });
    if (!b) missing.push({ ratingId: rating.id, ratedAudioId: rating.b.ratedAudioId });
    if (!a || !b) continue;
    const { id: ratingId, sessionId, leftSide, outcome } = rating;
    /** @param {"a" | "b"} side @param {number} weight */
    const won = (side, weight) => ({
      ratingId,
      sessionId,
      winner: side === "a" ? a : b,
      loser: side === "a" ? b : a,
      weight,
      tie: outcome === "tie",
      winnerLeft: leftSide === side,
    });
    if (outcome === "a" || outcome === "b") pairs.push(won(outcome, 1));
    else pairs.push(won("a", TIE_WEIGHT), won("b", TIE_WEIGHT));
  }

  /** @type {Thumb[]} */
  const thumbs = [];
  const live = feedback.filter((f) => f.removedAt === null && f.kind === FEEDBACK_KIND.thumbs);
  for (const row of [...live].sort(byId)) {
    if (!THUMBS.some((known) => known === row.direction)) {
      throw new Error(`feedback ${row.id} is thumbs ${JSON.stringify(row.direction)}`);
    }
    const made = item(row, `feedback ${row.id}`);
    if (!made) {
      missing.push({ feedbackId: row.id, ratedAudioId: row.ratedAudioId });
      continue;
    }
    const up = row.direction === "up";
    thumbs.push({ feedbackId: row.id, sessionId: row.sessionId, item: made, up });
  }
  return { pairs, thumbs, missing };
}

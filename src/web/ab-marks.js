// A candidate's A/B marks on the session page (decision 0049): how often it was chosen and not
// chosen in its session's live A/B ratings, and whether it was compared at all. No DOM.
import { OUTCOMES } from "../domain/rating-values.js";

const [A, B, TIE, SKIP] = OUTCOMES;

/** The most marks shown one by one; a larger count shows one mark and the number. */
export const MAX_MARKS = 5;

/** @typedef {{ genomeId: number | null, seed: number }} Heard */

/**
 * An A/B rating as `GET /api/vibes/:vibeId/ratings` lists it.
 * @typedef {object} AbRatingRow
 * @property {number} sessionId
 * @property {string} outcome one of OUTCOMES
 * @property {Heard} a
 * @property {Heard} b
 * @property {number | null} removedAt
 */

/**
 * @typedef {object} AbMarks
 * @property {number} wins live ratings where its side was chosen
 * @property {number} losses live ratings where the other side was chosen
 * @property {number} compared every live rating with it on a side, ties and skips included
 */

/**
 * @param {Heard} side
 * @param {Heard} heard
 */
const same = (side, heard) => side.genomeId === heard.genomeId && side.seed === heard.seed;

/**
 * Counts the candidate's marks from its session's live A/B ratings, matched by genome and seed.
 * Ties and skips count as compared only; an undone rating counts nothing.
 * @param {readonly AbRatingRow[]} ratings
 * @param {number} sessionId
 * @param {Heard} heard the candidate's genome and seed
 * @returns {AbMarks}
 */
export function abMarks(ratings, sessionId, heard) {
  const marks = { wins: 0, losses: 0, compared: 0 };
  for (const { sessionId: session, outcome, a, b, removedAt } of ratings) {
    if (session !== sessionId || removedAt !== null) continue;
    const side = same(a, heard) ? A : same(b, heard) ? B : null;
    if (side === null) continue;
    if (outcome !== A && outcome !== B && outcome !== TIE && outcome !== SKIP) {
      throw new Error(`an A/B rating has outcome ${outcome}, which the page doesn't know`);
    }
    marks.compared++;
    if (outcome === side) marks.wins++;
    else if (outcome === A || outcome === B) marks.losses++;
  }
  return marks;
}

/**
 * The marks for a count: one `glyph` per count up to MAX_MARKS, beyond that one with the count.
 * @param {number} count
 * @param {string} glyph
 */
export const markText = (count, glyph) =>
  count > MAX_MARKS ? `${glyph}×${count}` : glyph.repeat(count);

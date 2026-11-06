// What the owner heard and how they rated it: rated audio, A/B ratings, feedback and sketches
// (decision 0021). Every rating names what was heard, never a renders row, since renders are
// derived and get replaced.
/** @import { Removable, Row, Store } from "./store.js" */
import { decode, insertRow, selectRow, selectRows, TABLE } from "./store.js";

/**
 * An excerpt as heard: enough to render it again with the same engine.
 * @typedef {object} HeardExcerpt
 * @property {number} genomeId
 * @property {number} seed
 * @property {number} offset timeline seconds
 * @property {number} duration seconds
 * @property {number} engineVersion
 */

/**
 * @typedef {HeardExcerpt & {
 *   target: number,
 *   file: string,
 *   pcmSha256: string,
 *   gainDb: number,
 * }} RatedAudioDraft `target` in LUFS; `file` relative to the rated-audio folder; `pcmSha256`
 *   as `pcmHash` in check-rated-audio.js computes it
 */

/** @typedef {RatedAudioDraft & Removable & { id: number, createdAt: number }} RatedAudio */

/**
 * One side of an A/B rating. rank, score, modelVersion and wildcard stay null until phase 4.
 * @typedef {HeardExcerpt & {
 *   ratedAudioId: number,
 *   playedFraction: number,
 *   rank: number | null,
 *   score: number | null,
 *   modelVersion: string | null,
 *   wildcard: boolean | null,
 * }} RatingSide `playedFraction` from 0 to 1
 */

/**
 * @typedef {object} RatingDraft
 * @property {number} sessionId
 * @property {number} vibeRevisionId
 * @property {RatingSide} a
 * @property {RatingSide} b
 * @property {"a" | "b"} leftSide the side shown on the left
 * @property {number} orderSeed the seed the order was drawn from
 * @property {"a" | "b" | "tie" | "skip"} outcome
 * @property {number} timeTakenMs
 */

/** @typedef {RatingDraft & Removable & { id: number, createdAt: number }} Rating */

/**
 * Thumbs (`up` or `down`, with an optional note), or "more / less like this" on a macro (`more`
 * or `less`, with the macro's name and its effective value over the heard window).
 * @typedef {HeardExcerpt & {
 *   sessionId: number,
 *   vibeRevisionId: number,
 *   ratedAudioId: number,
 *   playedFraction: number,
 *   timeTakenMs: number,
 *   kind: "thumbs" | "macro",
 *   direction: "up" | "down" | "more" | "less",
 *   note: string | null,
 *   macro: string | null,
 *   macroValue: unknown,
 * }} FeedbackDraft
 */

/** @typedef {FeedbackDraft & Removable & { id: number, createdAt: number }} Feedback */

/**
 * @typedef {object} SketchDraft
 * @property {number} candidateId
 * @property {string} notes
 * @property {string[]} tags
 */

/** @typedef {SketchDraft & Removable & { id: number, createdAt: number }} Sketch */

const RATED_AUDIO = {};
const FEEDBACK = { json: ["macroValue"] };
const SKETCHES = { json: ["tags"] };

/**
 * Each side's fields are columns in `ratings` with the side's letter in front: side a's
 * `genomeId` is `aGenomeId`. No other column starts with `a` or `b` and a capital.
 */
const SIDE_COLUMN = /^([ab])([A-Z])(.*)$/;
/**
 * @param {"a" | "b"} side
 * @param {string} field
 */
const sideColumn = (side, field) => `${side}${field[0]?.toUpperCase()}${field.slice(1)}`;
const RATINGS = { boolean: [sideColumn("a", "wildcard"), sideColumn("b", "wildcard")] };

/**
 * @param {Store} store
 * @param {RatedAudioDraft} draft
 * @returns {RatedAudio}
 */
export function addRatedAudio(store, draft) {
  return insertRow(store, TABLE.ratedAudio, RATED_AUDIO, { ...draft });
}

/**
 * Every rated-audio row, removed ones too, since their files are kept.
 * @param {Store} store
 * @returns {RatedAudio[]}
 */
export function listRatedAudio(store) {
  return selectRows(store, TABLE.ratedAudio, RATED_AUDIO, {}, { includeRemoved: true });
}

/**
 * Throws unless the rated-audio row `heard` names has the heard identity written beside it.
 * @param {Store} store
 * @param {string} what names the rating or side in the message
 * @param {HeardExcerpt & { ratedAudioId: number }} heard
 */
function requireSameExcerpt(store, what, heard) {
  const id = heard.ratedAudioId;
  const row = store.db
    .prepare(
      `SELECT genomeId, seed, offset, duration, engineVersion FROM ${TABLE.ratedAudio} WHERE id = ?`,
    )
    .get(id);
  if (!row) throw new Error(`${what} names rated audio ${id}, and there is no rated audio ${id}`);
  /** @type {Record<string, unknown>} */
  const said = heard;
  const differs = Object.entries(row).filter(([field, value]) => said[field] !== value);
  if (differs.length > 0) {
    const listed = (/** @type {(field: string, value: unknown) => string} */ format) =>
      differs.map(([field, value]) => format(field, value)).join(", ");
    throw new Error(
      `${what} says ${listed((field) => `${field} ${said[field]}`)}, but its rated audio ${id} has ${listed((field, value) => `${field} ${value}`)}`,
    );
  }
}

/**
 * @param {Row} row
 * @returns {Rating}
 */
function ratingFromRow(row) {
  /** @type {Record<string, unknown>} */
  const flat = decode(RATINGS, row);
  /** @type {Record<string, unknown>} */
  const rating = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const sides = { a: {}, b: {} };
  for (const [column, value] of Object.entries(flat)) {
    const [, side = "", first = "", others = ""] = SIDE_COLUMN.exec(column) ?? [];
    const fields = sides[side];
    if (fields) fields[`${first.toLowerCase()}${others}`] = value;
    else rating[column] = value;
  }
  return /** @type {Rating} */ ({ ...rating, ...sides });
}

/**
 * @param {Store} store
 * @param {RatingDraft} draft
 * @returns {Rating}
 */
export function addRating(store, { a, b, ...rest }) {
  requireSameExcerpt(store, "side a of the rating", a);
  requireSameExcerpt(store, "side b of the rating", b);
  /** @type {Record<string, unknown>} */
  const values = { ...rest };
  for (const [field, value] of Object.entries(a)) values[sideColumn("a", field)] = value;
  for (const [field, value] of Object.entries(b)) values[sideColumn("b", field)] = value;
  /** @type {{ id: number }} */
  const { id } = insertRow(store, TABLE.ratings, RATINGS, values);
  const rating = getRating(store, id);
  if (!rating) throw new Error(`rating ${id} wasn't stored`);
  return rating;
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Rating | undefined}
 */
export function getRating(store, id) {
  const row = store.db.prepare(`SELECT * FROM ${TABLE.ratings} WHERE id = ?`).get(id);
  return row && ratingFromRow(row);
}

/**
 * @param {Store} store
 * @param {FeedbackDraft} draft
 * @returns {Feedback}
 */
export function addFeedback(store, draft) {
  requireSameExcerpt(store, "the feedback", draft);
  return insertRow(store, TABLE.feedback, FEEDBACK, { ...draft });
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Feedback | undefined}
 */
export function getFeedback(store, id) {
  return selectRow(store, TABLE.feedback, FEEDBACK, id);
}

/**
 * @param {Store} store
 * @param {SketchDraft} draft
 * @returns {Sketch}
 */
export function addSketch(store, draft) {
  return insertRow(store, TABLE.sketches, SKETCHES, { ...draft });
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Sketch | undefined}
 */
export function getSketch(store, id) {
  return selectRow(store, TABLE.sketches, SKETCHES, id);
}

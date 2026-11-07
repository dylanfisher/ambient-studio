// A candidate's current choices: its thumbs and one choice per macro (decision 0032). A newer
// row for the same thumbs or macro replaces an older one, so "more brightness" then "less
// brightness" reads as less, whether or not the server has marked the older row removed.

/**
 * The fields of a feedback row this reads.
 * @typedef {object} FeedbackRow
 * @property {number} id
 * @property {number} sessionId
 * @property {number} genomeId
 * @property {number} seed
 * @property {string | null} macro null for thumbs
 * @property {string} direction
 * @property {number} createdAt
 */

/**
 * @template {FeedbackRow} R
 * @param {readonly R[]} rows the vibe's feedback rows not removed
 * @param {{ sessionId: number, genomeId: number, seed: number }} candidate
 * @returns {{ thumbs: R | null, macros: Record<string, R> }}
 */
export function liveChoices(rows, { sessionId, genomeId, seed }) {
  const mine = rows
    .filter((row) => row.sessionId === sessionId && row.genomeId === genomeId && row.seed === seed)
    .sort((x, y) => x.createdAt - y.createdAt || x.id - y.id);
  /** @type {R | null} */
  let thumbs = null;
  /** @type {Record<string, R>} */
  const macros = {};
  for (const row of mine) {
    if (row.macro === null) thumbs = row;
    else macros[row.macro] = row;
  }
  return { thumbs, macros };
}

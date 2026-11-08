// The order a session's candidates are shown in under a taste model (decision 0046): by
// posterior mean, highest first, with one slot in every eight given to a wildcard drawn from
// outside the top half, so a candidate the model rates low still gets heard. The draws come
// from the counter-based PRNG (0003) under the session's id, so a session draws the same
// wildcards from the same scores every time.
import { drawer } from "../engine/prng.js";

/** One slot in this many is a wildcard. */
export const WILDCARD_EVERY = 8;

/** The wildcard's slot within its eight, counted from 1: the middle, so a listen from the top meets it. */
const WILDCARD_SLOT = 4;

/**
 * The key the draws are made under. It isn't a valid voice id, so it never shares a draw with
 * a render or with generation's sampling stream (decision 0003).
 */
const WILDCARD_ID = ":wildcard";

/**
 * @typedef {object} Ranking
 * @property {number[]} rank each item's place by mean, 1 for the highest
 * @property {boolean[]} wildcard
 * @property {number[]} slot each item's place in the shown order, from 1
 */

/**
 * @param {readonly number[]} means each item's posterior mean
 * @param {number} seed the session's id
 * @returns {Ranking} by item, in the order given
 */
export function rankCandidates(means, seed) {
  const byMean = means.map((_, i) => i).sort((x, y) => (means[y] ?? 0) - (means[x] ?? 0) || x - y);
  const rank = new Array(means.length).fill(0);
  for (const [place, i] of byMean.entries()) rank[i] = place + 1;

  // Outside the top half: below the first ceil(n / 2) places.
  const pool = byMean.slice(Math.ceil(means.length / 2));
  const count = Math.floor(means.length / WILDCARD_EVERY);
  const draw = drawer(seed, WILDCARD_ID);
  /** @type {number[]} */
  const wild = [];
  for (let k = 0; k < count; k++) {
    const [taken] = pool.splice(Math.floor(draw(k, 0) * pool.length), 1);
    wild.push(/** @type {number} */ (taken));
  }

  const wildcard = means.map((_, i) => wild.includes(i));
  const tame = byMean.filter((i) => !wildcard[i]);
  const slot = new Array(means.length).fill(0);
  for (let s = 1; s <= means.length; s++) {
    const due = s % WILDCARD_EVERY === WILDCARD_SLOT && wild.length > 0;
    slot[/** @type {number} */ (due ? wild.shift() : tame.shift())] = s;
  }
  return { rank, wildcard, slot };
}

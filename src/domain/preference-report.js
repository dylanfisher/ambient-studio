// Held-out agreement for the taste model test (decision 0045): the credit one call earns, and
// the pooled share with a bootstrap interval that resamples whole sessions.
import { drawer } from "../engine/prng.js";

/**
 * The bootstrap: `resamples` draws of the sessions with replacement, from the counter-based PRNG
 * under `seed`, so a report is the same every time its inputs are.
 */
export const BOOTSTRAP = Object.freeze({ resamples: 2000, seed: 45, unit: "session" });

/** The PRNG id the bootstrap's draws are keyed by. */
const BOOTSTRAP_ID = "agreement-bootstrap";

/** The two-sided interval's tails. */
const TAIL = 0.025;

/**
 * What a predictor's call on one pair earns: 1 when it scores the winner higher, 0 when lower,
 * and 0.5 when it makes no call, its scores being equal or one of them missing.
 * @param {number | null} winner the winner's score
 * @param {number | null} loser
 */
export function credit(winner, loser) {
  if (winner === null || loser === null || winner === loser) return 0.5;
  return winner > loser ? 1 : 0;
}

/**
 * One held-out session's tally for one predictor.
 * @typedef {object} SessionTally
 * @property {number} sessionId
 * @property {number} agreed the credit its pairs earned
 * @property {number} scored
 */

/**
 * @typedef {object} Agreement
 * @property {number} agreed
 * @property {number} scored
 * @property {number} share `agreed / scored`
 * @property {number} low the 95% interval's ends, as shares
 * @property {number} high
 */

/** @param {readonly SessionTally[]} tallies */
const pooled = (tallies) => {
  let agreed = 0;
  let scored = 0;
  for (const tally of tallies) {
    agreed += tally.agreed;
    scored += tally.scored;
  }
  return { agreed, scored };
};

/**
 * The pooled share over every session, with a percentile interval from `BOOTSTRAP.resamples`
 * resamples of the sessions. Pairs in one session share candidates and the owner's ears that
 * day, so the session is the unit drawn. A resample that draws only sessions with nothing
 * scored has no share and is left out of the percentiles. Every predictor's tallies listed in
 * the same session order get the same draws, so their intervals are paired.
 * @param {readonly SessionTally[]} tallies one per held-out session
 * @returns {Agreement | null} null when nothing was scored
 */
export function agreement(tallies) {
  const { agreed, scored } = pooled(tallies);
  if (scored === 0) return null;
  const next = drawer(BOOTSTRAP.seed, BOOTSTRAP_ID);
  /** @type {number[]} */
  const shares = [];
  for (let resample = 0; resample < BOOTSTRAP.resamples; resample++) {
    const drawn = tallies.map(
      (_, slot) =>
        /** @type {SessionTally} */ (tallies[Math.floor(next(resample, slot) * tallies.length)]),
    );
    const total = pooled(drawn);
    if (total.scored > 0) shares.push(total.agreed / total.scored);
  }
  shares.sort((a, b) => a - b);
  // Nearest rank, as `percentiles` reads it, so each end is a share some resample gave.
  const rank = (/** @type {number} */ p) =>
    /** @type {number} */ (shares[Math.max(0, Math.ceil(p * shares.length) - 1)]);
  return { agreed, scored, share: agreed / scored, low: rank(TAIL), high: rank(1 - TAIL) };
}

// The optimizer test's numbers (decision 0059), acceptance 4 of phase 5: per brief, each run's
// search best against its control's best by the taste model, counted only when 4e's held-out
// agreement beats chance; and blind spot-check pairs of the two arms' bests, judged by the
// owner with an exact one-sided binomial test once enough are decided.
import { drawer } from "../engine/prng.js";
import { exactMcNemar } from "./exact-mcnemar.js";
import { BOOTSTRAP } from "./preference-report.js";
import { OUTCOMES } from "./rating-values.js";

const [A, , TIE, SKIP] = OUTCOMES;

export const OPTIMIZER_TEST = Object.freeze({
  /** Searches per brief, each with its control. */
  runs: 3,
  /** Spot-check pairs per run: each arm's best 4, paired best to best. */
  spotPairsPerRun: 4,
  /** Decided pairs below which the owner's test reads inconclusive: 10 of 12 gives p = 0.019. */
  minimumPairs: 12,
  /** The one-sided test passes below this p. */
  alpha: 0.05,
  /** 4e's agreement must have its lower bound above this for the model's comparison to count. */
  chance: 0.5,
});

/** What a comparison found. */
export const VERDICT = Object.freeze({
  inconclusive: "undecided",
  /** The search's best is better. */
  search: "search-better",
  /** The control's best is better. */
  control: "control-better",
  /** Neither is shown to be better. */
  even: "no-difference",
});

export const MODEL_INCONCLUSIVE =
  "inconclusive: the model doesn't yet beat chance on held-out pairs";
export const OWNER_INCONCLUSIVE = "inconclusive, waiting on data";

/** The PRNG id the runs' bootstrap draws are keyed by. */
const BOOTSTRAP_ID = "optimizer-bootstrap";
/** The two-sided interval's tails. */
const TAIL = 0.025;

/**
 * One run's two bests by the taste model's score, null when that arm scored no point.
 * @typedef {{ search: number | null, control: number | null }} RunBests
 */

/**
 * @typedef {object} RunComparison
 * @property {number} compared runs with a best in both arms
 * @property {number} wins runs whose search best scored higher
 * @property {number} ties runs whose two bests scored the same, each half a win in `share`
 * @property {number} share `(wins + ties / 2) / compared`
 * @property {number} meanDifference the mean of search best less control best
 * @property {number} low the 95% interval's ends, from resampling runs
 * @property {number} high
 */

/** @param {readonly number[]} values */
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * The share of runs the search wins and the mean difference of the two bests, with a
 * percentile interval from `BOOTSTRAP.resamples` resamples of the runs under `BOOTSTRAP.seed`,
 * so the same runs give the same interval every time.
 * @param {readonly RunBests[]} runs
 * @returns {RunComparison | null} null when no run has both bests
 */
export function compareRuns(runs) {
  const differences = runs.flatMap(({ search, control }) =>
    search === null || control === null ? [] : [search - control],
  );
  if (differences.length === 0) return null;
  const wins = differences.filter((d) => d > 0).length;
  const ties = differences.filter((d) => d === 0).length;
  const next = drawer(BOOTSTRAP.seed, BOOTSTRAP_ID);
  /** @type {number[]} */
  const means = [];
  for (let resample = 0; resample < BOOTSTRAP.resamples; resample++) {
    means.push(
      mean(
        differences.map(
          (_, slot) =>
            /** @type {number} */ (
              differences[Math.floor(next(resample, slot) * differences.length)]
            ),
        ),
      ),
    );
  }
  means.sort((a, b) => a - b);
  // Nearest rank, as `agreement` reads it, so each end is a mean some resample gave.
  const rank = (/** @type {number} */ p) =>
    /** @type {number} */ (means[Math.max(0, Math.ceil(p * means.length) - 1)]);
  return {
    compared: differences.length,
    wins,
    ties,
    share: (wins + ties / 2) / differences.length,
    meanDifference: mean(differences),
    low: rank(TAIL),
    high: rank(1 - TAIL),
  };
}

/**
 * Acceptance 4's rule for the model's comparison: it counts only when the brief's held-out
 * agreement has its lower bound above chance. When it counts, the interval of the mean
 * difference says which arm is better, or neither when it holds 0.
 * @param {{ share: number, low: number, high: number } | null} agreement 4e's `Agreement`
 *   for the model
 * @param {RunComparison | null} comparison
 * @returns {{ counts: boolean, verdict: (typeof VERDICT)[keyof typeof VERDICT], text: string | null }}
 *   `text` is the inconclusive sentence when it doesn't count
 */
export function modelVerdict(agreement, comparison) {
  if (agreement === null || agreement.low <= OPTIMIZER_TEST.chance) {
    return { counts: false, verdict: VERDICT.inconclusive, text: MODEL_INCONCLUSIVE };
  }
  if (comparison === null) return { counts: false, verdict: VERDICT.inconclusive, text: null };
  const verdict =
    comparison.low > 0 ? VERDICT.search : comparison.high < 0 ? VERDICT.control : VERDICT.even;
  return { counts: true, verdict, text: null };
}

/** @typedef {{ candidateId: number, score: number }} Scored */

/** @param {readonly Scored[]} scored best first, a tie to the one evaluated first */
const bestFirst = (scored) =>
  scored
    .map((each, i) => ({ ...each, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ candidateId }) => candidateId);

/**
 * A run's spot-check pairs: the arms' points by score, best against best, then second against
 * second, up to `count`.
 * @param {readonly Scored[]} search the search's scored points, in the order evaluated
 * @param {readonly Scored[]} control the control's
 * @param {number} count
 * @returns {{ rank: number, search: number, control: number }[]} `rank` from 1
 */
export function spotPairs(search, control, count) {
  const a = bestFirst(search);
  const b = bestFirst(control);
  return a.slice(0, Math.min(count, b.length)).map((id, i) => ({
    rank: i + 1,
    search: id,
    control: /** @type {number} */ (b[i]),
  }));
}

/** @typedef {{ genomeId: number, seed: number }} Heard */

/**
 * One spot-check pair as the report stores it: its session, the seed its sides were drawn
 * from, and each arm's candidate with the excerpt identity a rating stores.
 * @typedef {{ sessionId: number, orderSeed: number, search: Heard, control: Heard }} SpotPair
 */

/**
 * The rating fields the tally reads.
 * @typedef {{ id: number, sessionId: number, orderSeed: number, outcome: string, a: Heard,
 *   b: Heard }} SpotRating
 */

/** @param {Heard} x @param {Heard} y */
const same = (x, y) => x.genomeId === y.genomeId && x.seed === y.seed;

/**
 * The pair's rating: the latest made in the pair's session of the pair's two excerpts, either
 * way round, with the order seed the test stored, or null when there is none. The seed keeps an
 * ordinary A/B rating of the same two excerpts from counting as a spot check.
 * @template {SpotRating} R
 * @param {SpotPair} pair
 * @param {readonly R[]} ratings live ratings
 * @returns {R | null}
 */
export function pairRating(pair, ratings) {
  /** @type {R | null} */
  let found = null;
  for (const r of ratings) {
    const matches =
      r.sessionId === pair.sessionId &&
      r.orderSeed === pair.orderSeed &&
      ((same(r.a, pair.search) && same(r.b, pair.control)) ||
        (same(r.a, pair.control) && same(r.b, pair.search)));
    if (matches && (found === null || r.id > found.id)) found = r;
  }
  return found;
}

/**
 * @typedef {object} OwnerTally
 * @property {number} wins pairs the owner chose the search's side of
 * @property {number} losses pairs the owner chose the control's side of
 * @property {number} ties
 * @property {number} skips
 * @property {number} decided wins and losses
 * @property {number} unrated
 * @property {number | null} p the exact one-sided binomial p of `wins` in `decided`, null below
 *   `OPTIMIZER_TEST.minimumPairs`
 * @property {(typeof VERDICT)[keyof typeof VERDICT]} verdict inconclusive below the minimum, else
 *   search when p is under alpha and even otherwise
 */

/**
 * The owner's choices on the spot-check pairs, each pair's rating as `pairRating` finds it.
 * @param {readonly SpotPair[]} pairs
 * @param {readonly SpotRating[]} ratings live ratings
 * @returns {OwnerTally}
 */
export function ownerTally(pairs, ratings) {
  const tally = { wins: 0, losses: 0, ties: 0, skips: 0, unrated: 0 };
  for (const pair of pairs) {
    const found = pairRating(pair, ratings);
    if (found === null) tally.unrated += 1;
    else if (found.outcome === TIE) tally.ties += 1;
    else if (found.outcome === SKIP) tally.skips += 1;
    else if (same(found.outcome === A ? found.a : found.b, pair.search)) tally.wins += 1;
    else tally.losses += 1;
  }
  const decided = tally.wins + tally.losses;
  if (decided < OPTIMIZER_TEST.minimumPairs) {
    return { ...tally, decided, p: null, verdict: VERDICT.inconclusive };
  }
  // Under no difference each decided pair is a fair coin, McNemar's discordant pair exactly.
  const p = exactMcNemar(tally.wins, tally.losses);
  return {
    ...tally,
    decided,
    p,
    verdict: p < OPTIMIZER_TEST.alpha ? VERDICT.search : VERDICT.even,
  };
}

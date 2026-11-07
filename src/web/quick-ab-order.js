// The order Quick A/B draws its pairs in (decision 0048). In champion mode the chosen side
// stays as the champion and meets the next challenger until every candidate has had a turn; a
// tie keeps the champion, and a skip uses up the challenger. In random mode each pair is drawn
// from those not yet rated, on this page or (`prior`) earlier in the session. Neither mode
// draws a pair rated on the page. No DOM, and the draws come from the `random` it is given, so
// a test fixes the order.
import { OUTCOMES } from "../domain/rating-values.js";

const [A, B] = OUTCOMES;

/** The two orders, as the page's switch names them. */
export const ORDER_MODES = /** @type {const} */ (["champion", "random"]);
const [CHAMPION, RANDOM] = ORDER_MODES;

/** @typedef {(typeof ORDER_MODES)[number]} OrderMode */
/** @typedef {[number, number]} Pair two candidate ids; in champion mode the champion first */

/**
 * @typedef {object} QuickAbOrder
 * @property {() => Pair | null} pair the pair to rate now, or null when the pool has run out
 * @property {(outcome: (typeof OUTCOMES)[number]) => void} rate the owner rated the pair, `a`
 *   being its first id
 * @property {(pair: Pair) => void} forget a rating of `pair` wasn't saved, so it doesn't count
 *   as rated; it is held out of the draw while that save waits for Retry, so the pair can't
 *   be rated twice
 * @property {(pair: Pair) => void} remember it was saved after all
 * @property {(pair: Pair) => void} release the failed save was dropped, so the pair can be
 *   drawn again
 * @property {(mode: OrderMode) => void} setMode switches order from the next pair on; the pair
 *   shown stays. The champion mode starts a new round with the champion so far kept
 * @property {() => OrderMode} mode
 * @property {() => number | null} champion the side last chosen, or the first champion drawn
 * @property {() => number} remaining how many pairs are still to come, this one included
 * @property {() => boolean} undo goes back to the pair and champion before the last rating,
 *   keeping the mode; false when there is none
 */

/**
 * @typedef {object} State
 * @property {number | null} champion
 * @property {number[]} challengers champion mode's challengers still to come, in order
 * @property {Pair | null} current
 * @property {Set<string>} rated each pair rated on the page, by key
 */

/**
 * One key for a pair, whichever way round.
 * @param {readonly number[]} pair
 */
export const pairKey = ([x = 0, y = 0]) => (x < y ? `${x}-${y}` : `${y}-${x}`);

/**
 * @param {readonly number[]} ids the candidates in the pool
 * @param {{ mode: OrderMode, random: () => number, prior?: Iterable<string> }} options
 *   `random` draws in [0, 1); `prior` is the keys of pairs the session already rated, which
 *   random mode leaves out
 * @returns {QuickAbOrder}
 */
export function createQuickAbOrder(ids, { mode: startMode, random, prior = [] }) {
  const before = new Set(prior);
  /** Pairs whose rating failed to save since they were rated, which undo must not bring back. */
  const forgotten = new Set();
  /** Pairs with a failed save waiting for Retry or Discard, which no draw offers. */
  const held = new Set();
  let mode = startMode;

  /** @param {readonly number[]} list */
  const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [/** @type {number} */ (out[j]), /** @type {number} */ (out[i])];
    }
    return out;
  };

  /** @param {State} at */
  const unratedPairs = (at) => {
    /** @type {Pair[]} */
    const pairs = [];
    for (const [i, x] of ids.entries()) {
      for (const y of ids.slice(i + 1)) {
        const key = pairKey([x, y]);
        if (!at.rated.has(key) && !before.has(key) && !held.has(key)) pairs.push([x, y]);
      }
    }
    return pairs;
  };

  /**
   * Sets `current` to the next pair of the mode.
   * @param {State} at
   */
  const draw = (at) => {
    if (mode === RANDOM) {
      const pairs = unratedPairs(at);
      at.current = pairs[Math.floor(random() * pairs.length)] ?? null;
      return;
    }
    at.current = null;
    while (at.challengers.length > 0) {
      const challenger = /** @type {number} */ (at.challengers.shift());
      if (at.champion === null) {
        at.champion = challenger;
        continue;
      }
      /** @type {Pair} */
      const pair = [at.champion, challenger];
      const key = pairKey(pair);
      if (challenger === at.champion || at.rated.has(key) || held.has(key)) continue;
      at.current = pair;
      return;
    }
  };

  /**
   * A champion round over every candidate but the champion, in a fresh order.
   * @param {State} at
   */
  const newRound = (at) => {
    at.champion ??= at.current?.[0] ?? null;
    at.challengers = shuffled(ids.filter((id) => id !== at.champion));
  };

  /** @type {State} */
  let state = { champion: null, challengers: [], current: null, rated: new Set() };
  if (mode === CHAMPION) newRound(state);
  draw(state);
  /** @type {{ state: State, mode: OrderMode }[]} the state before each rating, newest last */
  const history = [];

  return {
    pair: () => state.current,
    rate(outcome) {
      const pair = state.current;
      if (!pair) throw new Error("There is no pair to rate: every pair has been rated.");
      history.push({
        state: { ...state, challengers: [...state.challengers], rated: new Set(state.rated) },
        mode,
      });
      state.rated.add(pairKey(pair));
      forgotten.delete(pairKey(pair));
      if (outcome === A) state.champion = pair[0];
      else if (outcome === B) state.champion = pair[1];
      else state.champion ??= pair[0];
      draw(state);
    },
    forget(pair) {
      state.rated.delete(pairKey(pair));
      forgotten.add(pairKey(pair));
      held.add(pairKey(pair));
    },
    remember(pair) {
      state.rated.add(pairKey(pair));
      forgotten.delete(pairKey(pair));
      held.delete(pairKey(pair));
    },
    release(pair) {
      held.delete(pairKey(pair));
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      if (mode === CHAMPION) newRound(state);
      if (!state.current) draw(state);
    },
    mode: () => mode,
    champion: () => state.champion,
    remaining() {
      if (!state.current) return 0;
      if (mode === RANDOM) return unratedPairs(state).length;
      return 1 + state.challengers.length;
    },
    undo() {
      const last = history.pop();
      if (!last) return false;
      state = last.state;
      for (const key of forgotten) state.rated.delete(key);
      if (mode === CHAMPION && last.mode !== CHAMPION) newRound(state);
      return true;
    },
  };
}

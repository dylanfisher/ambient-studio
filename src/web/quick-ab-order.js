// The order Quick A/B draws its pairs in (decision 0048). In champion mode the chosen side
// stays as the champion and meets the next challenger until every candidate has had a turn; a
// tie keeps the champion, and a skip uses up the challenger. In random mode each pair is drawn
// from those not yet rated. Neither mode draws a pair that was rated before on the page. No
// DOM, and the draws come from the `random` it is given, so a test fixes the order.
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
 * @property {(mode: OrderMode) => void} setMode switches order from the next pair on; the
 *   champion mode starts a new round, with the champion so far kept
 * @property {() => OrderMode} mode
 * @property {() => number | null} champion the side last chosen, or the first champion drawn
 * @property {() => number} remaining how many pairs are still to come, this one included
 * @property {() => boolean} undo goes back to before the last rating; false when there is none
 */

/**
 * @typedef {object} State
 * @property {OrderMode} mode
 * @property {number | null} champion
 * @property {number[]} challengers champion mode's challengers still to come, in order
 * @property {Pair | null} current
 * @property {string[]} rated each rated pair's key
 */

/** @param {Pair} pair */
const pairKey = ([x, y]) => (x < y ? `${x}-${y}` : `${y}-${x}`);

/**
 * @param {readonly number[]} ids the candidates in the pool
 * @param {{ mode: OrderMode, random: () => number }} options `random` draws in [0, 1)
 * @returns {QuickAbOrder}
 */
export function createQuickAbOrder(ids, { mode, random }) {
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
        if (!at.rated.includes(pairKey([x, y]))) pairs.push([x, y]);
      }
    }
    return pairs;
  };

  /**
   * Sets `current` to the next pair of the state's mode.
   * @param {State} at
   */
  const draw = (at) => {
    if (at.mode === RANDOM) {
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
      if (at.rated.includes(pairKey(pair))) continue;
      at.current = pair;
      return;
    }
  };

  /**
   * A champion round over every candidate but the champion, in a fresh order.
   * @param {State} at
   */
  const startRound = (at) => {
    at.challengers = shuffled(ids.filter((id) => id !== at.champion));
    draw(at);
  };

  /** @type {State} */
  let state = { mode, champion: null, challengers: [], current: null, rated: [] };
  if (mode === CHAMPION) startRound(state);
  else draw(state);
  /** @type {State[]} the state before each rating, newest last */
  const history = [];

  return {
    pair: () => state.current,
    rate(outcome) {
      const pair = state.current;
      if (!pair) throw new Error("There is no pair to rate: every pair has been rated.");
      history.push({ ...state, challengers: [...state.challengers], rated: [...state.rated] });
      state.rated.push(pairKey(pair));
      if (outcome === A) state.champion = pair[0];
      else if (outcome === B) state.champion = pair[1];
      else state.champion ??= pair[0];
      draw(state);
    },
    setMode(next) {
      if (next === state.mode) return;
      state.mode = next;
      if (next === CHAMPION) {
        state.champion ??= state.current?.[0] ?? null;
        startRound(state);
      } else {
        draw(state);
      }
    },
    mode: () => state.mode,
    champion: () => state.champion,
    remaining() {
      if (!state.current) return 0;
      if (state.mode === RANDOM) return unratedPairs(state).length;
      return 1 + state.challengers.length;
    },
    undo() {
      const before = history.pop();
      if (!before) return false;
      state = before;
      return true;
    },
  };
}

// What the Quick A/B page does in spot-check mode (decision 0059), with no DOM: the session's
// blind pairs from the optimizer test, each a search's point against a control nudge, played in
// turn with the sides the test drew from a stored seed. Each choice is an ordinary A/B rating,
// saved by `POST …/ab-ratings` with that seed, so the row holds the session and the sides. The
// page names neither side, so the owner can't tell which arm is which. The view has the shape
// `quick-ab-session.js` gives, so the page renders all modes alike.
/** @import { AbPair } from "./ab-view.js" */
/** @import { Outcome } from "./ab-rating.js" */
/** @import { Playable, QuickAbView } from "./quick-ab-session.js" */
import { abRatingBody } from "./ab-rating.js";
import { getJson, postJson, sessionPath } from "./api.js";
import { outcomeText } from "./outcome-text.js";
import { ORDER_MODES } from "./quick-ab-order.js";
import { LOADING, PHASE } from "./quick-ab-session.js";

const [CHAMPION] = ORDER_MODES;

/** Why Undo does nothing here. */
export const NO_SPOT_UNDO =
  "A spot-check choice can't be taken back here: each pair is asked once, so choose with care.";

/** What a side is called on the page, so neither arm is named. */
export const SPOT_NAMES = Object.freeze({ left: "Left", right: "Right" });

/**
 * One pair as `GET …/spot-checks` lists it.
 * @typedef {{ evaluationId: number, run: string, rank: number, rated: boolean,
 *   pair: AbPair | null, a: Playable | null, b: Playable | null }} SpotCheck
 */

/**
 * @typedef {object} SpotState
 * @property {number} total the session's pairs
 * @property {number} rated
 * @property {number} missing pairs not rated whose excerpts aren't rendered
 * @property {boolean} stopped whether the session has stopped, so takes no ratings
 */

/** @typedef {QuickAbView & { spot: SpotState | null }} SpotSessionView */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {{ sessionId: number, now: () => number, onChange: () => void }} options `now` is the
 *   page's monotonic clock in ms, for time taken
 */
export function createSpotSession({ sessionId, now, onChange }) {
  const SESSION = sessionPath(sessionId);
  /** @type {(typeof PHASE)[keyof typeof PHASE]} */
  let phase = PHASE.loading;
  /** @type {SpotCheck[]} the pairs still to rate that can be played, in order */
  let queue = [];
  /** @type {SpotState | null} */
  let spot = null;
  /** @type {number | null} */
  let shownAt = null;
  let message = LOADING;
  let saving = 0;
  let busy = false;

  async function read() {
    /** @type {{ stopped: boolean, pairs: SpotCheck[] }} */
    const listed = await getJson(`${SESSION}/spot-checks`);
    const open = listed.pairs.filter((p) => !p.rated);
    queue = open.filter((p) => p.pair !== null);
    spot = {
      total: listed.pairs.length,
      rated: listed.pairs.length - open.length,
      missing: open.length - queue.length,
      stopped: listed.stopped,
    };
    show();
  }

  function show() {
    phase = queue.length > 0 && !spot?.stopped ? PHASE.pair : PHASE.done;
    shownAt = phase === PHASE.pair ? now() : null;
    onChange();
  }

  /** @param {() => Promise<void>} work */
  async function exclusive(work) {
    if (busy) return;
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
  }

  return {
    /** @returns {SpotSessionView} */
    view() {
      const current = phase === PHASE.pair ? queue[0] : undefined;
      const pair = /** @type {AbPair | undefined} */ (current?.pair ?? undefined);
      const a = /** @type {Playable} */ (current?.a);
      const b = /** @type {Playable} */ (current?.b);
      return {
        phase,
        shown:
          current && pair
            ? {
                pair,
                ids: [a.id, b.id],
                left: pair.leftSide === "a" ? a : b,
                right: pair.leftSide === "a" ? b : a,
              }
            : null,
        pairError: null,
        saving,
        failed: [],
        undoError: null,
        message,
        mode: CHAMPION,
        champion: null,
        remaining: queue.length,
        poolSize: 2,
        bestAvailable: false,
        spot,
      };
    },

    /** Whether leaving now would lose a choice being saved. */
    unsaved: () => saving > 0,

    /** Reads the session and its spot-check pairs, and shows the first not yet rated. */
    async load() {
      const session = await getJson(SESSION);
      message =
        "Spot check: each pair is one excerpt from a search and one from its control, sides drawn at random. Press ← or → to listen, then A or D to choose.";
      await read();
      return session;
    },

    /**
     * Saves the choice as an A/B rating with the pair's stored seed, then shows the next pair.
     * @param {Outcome} outcome
     * @param {{ left: number, right: number }} played each side's played fraction
     */
    choose: (outcome, played) =>
      exclusive(async () => {
        const current = queue[0];
        if (phase !== PHASE.pair || !current?.pair) return;
        const n = /** @type {SpotState} */ (spot).rated + 1;
        saving = 1;
        message = `Saving your choice on pair ${n}…`;
        onChange();
        try {
          await postJson(
            `${SESSION}/ab-ratings`,
            abRatingBody(current.pair, outcome, played, now() - /** @type {number} */ (shownAt)),
          );
        } catch (error) {
          message = `Your choice on pair ${n} wasn't saved: ${messageOf(error)} Choose again.`;
          return;
        } finally {
          saving = 0;
          onChange();
        }
        queue = queue.slice(1);
        /** @type {SpotState} */ (spot).rated += 1;
        message = `Pair ${n}: ${outcomeText({ outcome, leftSide: current.pair.leftSide })}.`;
        show();
      }),

    /** Reads the pairs again. */
    retry: () => exclusive(read),

    undo: () =>
      exclusive(async () => {
        message = NO_SPOT_UNDO;
        onChange();
      }),

    /** Nothing saves in the background here, so there is nothing to discard. */
    discard: async () => {},

    /** The order is the test's; the switch is hidden in this mode. */
    setMode: async () => {},
  };
}

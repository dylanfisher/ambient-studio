// What the Quick A/B page does in search-by-ear mode (decision 0055), with no DOM: champion mode
// against a search instead of a pool. The search's best stays, each new point comes from the
// server's search by ear, and each choice is an ordinary A/B rating, saved by `POST …/ab-ratings`
// as the other modes save one, then named to the search, whose reply holds the next pair. The
// next pair's excerpt is rendered while the owner listens, so it plays at once. A choice is
// sent before the next pair shows, since the search draws the next point from it, and a told
// choice can't be taken back. The view has the shape `quick-ab-session.js` gives, so the page
// renders both alike.
/** @import { AbPair } from "./ab-view.js" */
/** @import { Outcome } from "./ab-rating.js" */
/** @import { Pair } from "./quick-ab-order.js" */
/** @import { Playable, QuickAbView } from "./quick-ab-session.js" */
import { EAR_PHASE } from "../domain/ear-settings.js";
import { OUTCOMES } from "../domain/rating-values.js";
import { abRatingBody } from "./ab-rating.js";
import { getJson, postJson, sessionPath } from "./api.js";
import { outcomeText } from "./outcome-text.js";
import { ORDER_MODES } from "./quick-ab-order.js";
import { LOADING, nameOf, PHASE } from "./quick-ab-session.js";

const [A, B] = OUTCOMES;
const [CHAMPION] = ORDER_MODES;

/** Why Undo does nothing here. */
export const NO_UNDO =
  "A choice in a search by ear can't be taken back: the search has already drawn its next point from it. Choose again on the next pair.";

/**
 * The search by ear as the server reports it (`EarView` in `ear-search-job.js`).
 * @typedef {object} EarState
 * @property {(typeof EAR_PHASE)[keyof typeof EAR_PHASE]} phase
 * @property {number} query
 * @property {number} budget
 * @property {number} answered
 * @property {Playable | null} best
 * @property {Playable | null} challenger
 * @property {boolean} stopped
 * @property {string | null} error
 */

/**
 * The Quick A/B view, with how far the search has got.
 * @typedef {QuickAbView & { ear: EarState | null }} EarSessionView
 */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {{ sessionId: number, now: () => number, pause: () => Promise<void>,
 *   onChange: () => void }} options `now` is the page's monotonic clock in ms, for time taken;
 *   `pause` waits between reads of a search still drawing its pair
 */
export function createEarSession({ sessionId, now, pause, onChange }) {
  const SESSION = sessionPath(sessionId);
  const EAR = `${SESSION}/ear-search`;
  /** @type {(typeof PHASE)[keyof typeof PHASE]} */
  let phase = PHASE.loading;
  /** @type {EarState | null} */
  let ear = null;
  /** @type {{ pair: AbPair, ids: Pair, query: number, shownAt: number } | null} */
  let shown = null;
  /** @type {string | null} */
  let pairError = null;
  let message = LOADING;
  let saving = 0;
  /** @type {{ query: number, ratingId: number, said: string } | null} saved, not yet told */
  let untold = null;
  let busy = false;

  /** @param {number} id */
  const playable = (id) => {
    const found = [ear?.best, ear?.challenger].find((side) => side?.id === id);
    if (!found) throw new Error(`candidate ${id} is not in the search's pair`);
    return found;
  };

  /**
   * Shows the search's pair, reading again while it is drawn, until it asks or ends.
   * @param {EarState} state the search's state as last read
   */
  async function follow(state) {
    let current = state;
    ear = current;
    // A stopped search ends at its next step; until then its pair is not to be answered.
    while (
      current.phase === EAR_PHASE.drawing ||
      (current.stopped && current.phase !== EAR_PHASE.finished)
    ) {
      phase = PHASE.loading;
      onChange();
      await pause();
      current = await getJson(EAR);
      ear = current;
    }
    if (current.phase === EAR_PHASE.finished) {
      shown = null;
      phase = PHASE.done;
      onChange();
      return;
    }
    if (shown?.query === current.query) {
      phase = PHASE.pair;
      onChange();
      return;
    }
    const { query } = current;
    const best = /** @type {Playable} */ (current.best);
    const challenger = /** @type {Playable} */ (current.challenger);
    shown = null;
    pairError = null;
    try {
      /** @type {AbPair} */
      const pair = await postJson(`${SESSION}/ab-pairs`, {
        a: best.excerpt.renderId,
        b: challenger.excerpt.renderId,
      });
      shown = { pair, ids: [best.id, challenger.id], query, shownAt: now() };
      phase = PHASE.pair;
    } catch (error) {
      phase = PHASE.pairFailed;
      pairError = `The next pair couldn't be drawn: ${messageOf(error)}`;
    }
    onChange();
  }

  /**
   * Names the saved rating to the search, and shows the pair its reply holds.
   * @param {{ query: number, ratingId: number, said: string }} answer
   */
  async function tell(answer) {
    untold = answer;
    let state;
    try {
      state = await postJson(`${EAR}/answers`, { query: answer.query, ratingId: answer.ratingId });
    } catch (error) {
      pairError = `${answer.said} was saved, but the search didn't take it: ${messageOf(error)} Retry sends it again.`;
      phase = PHASE.pairFailed;
      onChange();
      return;
    }
    untold = null;
    await follow(state);
  }

  /**
   * Runs one action at a time: a key pressed while the next pair loads does nothing.
   * @param {() => Promise<void>} work
   */
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
    /** @returns {EarSessionView} */
    view() {
      const onLeft = shown?.pair.leftSide === "a";
      return {
        phase,
        shown: shown && {
          pair: shown.pair,
          ids: shown.ids,
          left: playable(onLeft ? shown.ids[0] : shown.ids[1]),
          right: playable(onLeft ? shown.ids[1] : shown.ids[0]),
        },
        pairError,
        saving,
        failed: [],
        undoError: null,
        message,
        mode: CHAMPION,
        champion: ear?.best?.id ?? null,
        remaining: ear === null || ear.phase === EAR_PHASE.finished ? 0 : ear.budget - ear.query,
        poolSize: 2,
        bestAvailable: false,
        ear,
      };
    },

    /** Whether leaving now would lose a choice: one being saved, or saved and not yet told. */
    unsaved: () => saving > 0 || untold !== null,

    /** Reads the session and its search by ear, and shows the search's pair. */
    async load() {
      const session = await getJson(SESSION);
      message =
        "Searching by ear: the one that stays is the best so far. Press ← or → to listen, then A or D to choose.";
      await follow(await getJson(EAR));
      return session;
    },

    /**
     * Saves the choice as an A/B rating, tells it to the search, and shows the next pair.
     * @param {Outcome} outcome
     * @param {{ left: number, right: number }} played each side's played fraction
     */
    choose: (outcome, played) =>
      exclusive(async () => {
        if (phase !== PHASE.pair || !shown) return;
        const { pair, ids, query, shownAt } = shown;
        const said = `Your choice on pair ${query + 1}`;
        saving = 1;
        message = `Saving your choice on pair ${query + 1}…`;
        onChange();
        /** @type {{ id: number }} */
        let row;
        try {
          row = await postJson(
            `${SESSION}/ab-ratings`,
            abRatingBody(pair, outcome, played, now() - shownAt),
          );
        } catch (error) {
          message = `${said} wasn't saved: ${messageOf(error)} Choose again.`;
          return;
        } finally {
          saving = 0;
          onChange();
        }
        message = `Pair ${query + 1}: ${outcomeWords(outcome, ids)}.`;
        await tell({ query, ratingId: row.id, said });
      }),

    /** Sends a choice the search didn't take again, or draws the pair again. */
    retry: () =>
      exclusive(async () => {
        if (untold) {
          const state = await getJson(EAR);
          // The search took it after all when it has moved past that pair.
          if (state.phase !== EAR_PHASE.listening || state.query !== untold.query) {
            untold = null;
            await follow(state);
            return;
          }
          await tell(untold);
          return;
        }
        shown = null;
        await follow(await getJson(EAR));
      }),

    undo: () =>
      exclusive(async () => {
        message = NO_UNDO;
        onChange();
      }),

    /** Nothing fails to save in the background here, so there is nothing to discard. */
    discard: async () => {},

    /** The order is the search's; the switch is hidden in this mode. */
    setMode: async () => {},

    /** Ends the search; its best so far stays as the run's best in the session. */
    stop: () =>
      exclusive(async () => {
        await follow(await postJson(`${EAR}/stop`, {}));
        message = "Stopped. The best so far is shown first in its fold on the session page.";
        onChange();
      }),
  };
}

/**
 * The choice in words, by the candidates' names.
 * @param {Outcome} outcome
 * @param {Pair} ids the pair's sides a and b: the best, then the new point
 */
function outcomeWords(outcome, [best, challenger]) {
  if (outcome === A) return `chose ${nameOf(best)}`;
  if (outcome === B) return `chose ${nameOf(challenger)}`;
  // Not a side, so outcomeText reads it without the order.
  return outcomeText({ outcome, leftSide: A });
}

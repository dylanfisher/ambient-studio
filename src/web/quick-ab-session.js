// What the Quick A/B page does, with no DOM (decision 0048): loads a session's pool, draws each
// pair's sides from the server, queues each rating to be saved in the background, keeps the
// ratings that failed to save until a Retry saves them, and undoes the last rating only once
// the server has removed it. The page renders `view()` after each change and passes the keys
// and buttons in. Every request goes through `api.js`, so a test answers them with a fake fetch.
/** @import { AbPair } from "./ab-view.js" */
/** @import { Outcome } from "./ab-rating.js" */
/** @import { OrderMode, Pair, Question } from "./quick-ab-order.js" */
import { OUTCOMES } from "../domain/rating-values.js";
import { abRatingBody } from "./ab-rating.js";
import { getJson, postJson, sessionPath, VIBES_PATH } from "./api.js";
import { questionOf } from "./best-question.js";
import { outcomeText } from "./outcome-text.js";
import { createQuickAbOrder, ORDER_MODES, ratedPairKeys } from "./quick-ab-order.js";

const [A, B] = OUTCOMES;
const [CHAMPION] = ORDER_MODES;

/**
 * What the page is doing: drawing a pair's sides, showing a pair, waiting for Retry because the
 * sides couldn't be drawn, or done because the pool ran out.
 */
export const PHASE = /** @type {const} */ ({
  loading: "loading",
  pair: "pair",
  pairFailed: "pairFailed",
  done: "done",
});

/** @typedef {{ renderId: number, url: string, duration: number }} Excerpt */
/** @typedef {{ id: number, genomeId: number, seed: number, excerpt: Excerpt }} Playable */
/** @typedef {{ id: number, genomeId: number | null, seed: number, excerpt: Excerpt | null, hidden: boolean }} Candidate */

/**
 * The candidates Quick A/B draws from: those with an excerpt to play that the owner hasn't
 * hidden on the session page (0048, 0049).
 * @param {Candidate[]} candidates
 * @returns {Playable[]}
 */
export const poolOf = (candidates) =>
  /** @type {Playable[]} */ (
    candidates.filter((candidate) => candidate.excerpt !== null && !candidate.hidden)
  );

/** @param {number} id */
export const nameOf = (id) => `Candidate #${id}`;

/**
 * What a choice says, by the candidates' names.
 * @param {Outcome} outcome
 * @param {Pair} ids the pair's sides a and b
 */
function choiceText(outcome, [a, b]) {
  if (outcome === A) return `${nameOf(a)} over ${nameOf(b)}`;
  if (outcome === B) return `${nameOf(b)} over ${nameOf(a)}`;
  // Not a side, so outcomeText reads it without the order.
  return `${nameOf(a)} against ${nameOf(b)}, ${outcomeText({ outcome, leftSide: A })}`;
}

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * A rating made on the page.
 * @typedef {object} Save
 * @property {number} id
 * @property {Pair} ids
 * @property {Record<string, unknown>} body what `POST …/ab-ratings` takes
 * @property {string} said
 * @property {"queued" | "sending" | "saved" | "failed"} state
 * @property {{ id: number } | null} row once saved
 * @property {string | null} error why it last failed
 * @property {Promise<void>} settled resolves when its last send has saved or failed
 * @property {() => void} settle
 */

/**
 * What the page shows.
 * @typedef {object} QuickAbView
 * @property {(typeof PHASE)[keyof typeof PHASE]} phase
 * @property {{ pair: AbPair, ids: Pair, left: Playable, right: Playable } | null} shown
 * @property {string | null} pairError
 * @property {number} saving ratings queued or being sent
 * @property {{ id: number, said: string, error: string }[]} failed ratings that didn't save
 * @property {string | null} undoError
 * @property {string} message what the last action did
 * @property {OrderMode} mode
 * @property {number | null} champion
 * @property {number} remaining
 * @property {number} poolSize
 * @property {boolean} bestAvailable whether the session is ranked, so best questions can be
 *   chosen (decision 0046)
 */

/**
 * @param {{ sessionId: number, random: () => number, now: () => number, onChange: () => void, onError: (error: Error) => void }} options
 *   `now` is the page's monotonic clock in ms, for time taken; `onError` reports a fault the
 *   page should show
 */
export function createQuickAbSession({ sessionId, random, now, onChange, onError }) {
  const SESSION = sessionPath(sessionId);
  /** @type {Map<number, Playable>} */
  const pool = new Map();
  /** @type {OrderMode} the mode the switch asks for, kept across a load */
  let mode = CHAMPION;
  let order = createQuickAbOrder([], { mode, random });
  /** @type {Question | null} the pair picker, once a ranked session's pool is read */
  let question = null;
  let nextSaveId = 1;
  /** @type {QuickAbView["phase"]} */
  let phase = PHASE.loading;
  /** @type {{ pair: AbPair, ids: Pair, shownAt: number } | null} */
  let shown = null;
  /** @type {string | null} */
  let pairError = null;
  /** @type {string | null} */
  let undoError = null;
  let message = "Loading…";
  /** @type {Save[]} every rating made on the page, oldest first; undo removes the last */
  const saves = [];
  let draining = false;
  let busy = false;

  /** Shows the order's pair once its sides are drawn; a failed draw leaves it for Retry. */
  async function showPair() {
    shown = null;
    pairError = null;
    const ids = order.pair();
    if (!ids) {
      phase = PHASE.done;
      onChange();
      return;
    }
    phase = PHASE.loading;
    onChange();
    const [a, b] = ids.map((id) => pool.get(id));
    if (!a || !b)
      throw new Error(`the pair ${ids[0]} and ${ids[1]} names a candidate not in the pool`);
    try {
      /** @type {AbPair} */
      const pair = await postJson(`${SESSION}/ab-pairs`, {
        a: a.excerpt.renderId,
        b: b.excerpt.renderId,
      });
      shown = { pair, ids, shownAt: now() };
      phase = PHASE.pair;
    } catch (error) {
      phase = PHASE.pairFailed;
      pairError = `The next pair couldn't be drawn: ${messageOf(error)}`;
    }
    onChange();
  }

  /** Tells the page, reporting a throw instead of letting it stop the save queue. */
  const notify = () => {
    try {
      onChange();
    } catch (error) {
      onError(/** @type {Error} */ (error));
    }
  };

  /**
   * Sends one save. Whatever throws, the save ends saved or failed and its `settled` resolves,
   * so undo never waits on it forever; a throw outside the request is reported too.
   * @param {Save} save
   */
  async function send(save) {
    try {
      save.state = "sending";
      notify();
      save.row = await postJson(`${SESSION}/ab-ratings`, save.body);
      save.state = "saved";
      save.error = null;
      order.remember(save.ids);
    } catch (error) {
      save.state = "failed";
      save.error = messageOf(error);
      order.forget(save.ids);
    } finally {
      if (save.state === "sending") save.state = "failed";
      save.settle();
      notify();
    }
  }

  /** Sends the queued ratings one after another, so the server captures one at a time. */
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (let next = saves.find(({ state }) => state === "queued"); next; ) {
        await send(next);
        next = saves.find(({ state }) => state === "queued");
      }
    } finally {
      draining = false;
    }
  }
  const startDrain = () => {
    drain().catch(onError);
  };

  /** @param {Save} save */
  const queue = (save) => {
    save.state = "queued";
    save.settled = new Promise((resolve) => {
      save.settle = resolve;
    });
  };

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
    /** @returns {QuickAbView} */
    view() {
      const side = (/** @type {number} */ id) => /** @type {Playable} */ (pool.get(id));
      const onLeft = shown?.pair.leftSide === "a";
      return {
        phase,
        shown: shown && {
          pair: shown.pair,
          ids: shown.ids,
          left: side(onLeft ? shown.ids[0] : shown.ids[1]),
          right: side(onLeft ? shown.ids[1] : shown.ids[0]),
        },
        pairError,
        saving: saves.filter(({ state }) => state === "queued" || state === "sending").length,
        failed: saves
          .filter(({ state }) => state === "failed")
          .map(({ id, said, error }) => ({ id, said, error: /** @type {string} */ (error) })),
        undoError,
        message,
        mode: order.mode(),
        champion: order.champion(),
        remaining: order.remaining(),
        poolSize: pool.size,
        bestAvailable: question !== null,
      };
    },

    /** Whether leaving the page now would lose a rating not yet saved. */
    unsaved: () => saves.some(({ state }) => state !== "saved"),

    /** Reads the session's pool and the pairs it already rated, and shows the first pair. */
    async load() {
      const session = await getJson(SESSION);
      const { candidates, ranking } = await getJson(`${SESSION}/candidates`);
      for (const candidate of poolOf(candidates)) pool.set(candidate.id, candidate);
      question = questionOf(ranking, [...pool.values()]);
      const { ratings } = await getJson(`${VIBES_PATH}/${session.vibeId}/ratings`);
      const prior = ratedPairKeys(ratings, sessionId, [...pool.values()]);
      // `mode`, not the default: the switch may have changed while the pool was read. Best
      // questions can't be chosen until the ranking is read, so it is never the mode here
      // without a picker.
      order = createQuickAbOrder([...pool.keys()], { mode, random, prior, question });
      message =
        pool.size < 2
          ? "Nothing to compare yet."
          : `${pool.size} candidates to compare. Press ← or → to listen, then A or D to choose.`;
      await showPair();
      return session;
    },

    /**
     * Rates the pair shown, queues the rating to be saved, and shows the next pair at once.
     * @param {Outcome} outcome
     * @param {{ left: number, right: number }} played each side's played fraction
     */
    choose: (outcome, played) =>
      exclusive(async () => {
        if (phase !== PHASE.pair || !shown) return;
        const { pair, ids, shownAt } = shown;
        const said = choiceText(outcome, ids);
        /** @type {Save} */
        const save = {
          id: nextSaveId++,
          ids,
          body: abRatingBody(pair, outcome, played, now() - shownAt),
          said,
          state: "queued",
          row: null,
          error: null,
          settled: Promise.resolve(),
          settle: () => {},
        };
        queue(save);
        saves.push(save);
        order.rate(outcome);
        message = `Chose ${said}.`;
        undoError = null;
        startDrain();
        await showPair();
      }),

    /** Sends the ratings that failed again, and draws the pair again if that failed. */
    retry: () =>
      exclusive(async () => {
        for (const save of saves) if (save.state === "failed") queue(save);
        startDrain();
        if (phase === PHASE.pairFailed) await showPair();
        else onChange();
      }),

    /**
     * Takes the last rating back: removed on the server first, and only then from the page, so
     * a failed remove leaves it in place with the error shown.
     */
    undo: () =>
      exclusive(async () => {
        const last = saves.at(-1);
        if (!last) {
          message = "There is no choice to undo.";
          onChange();
          return;
        }
        if (last.state === "queued" || last.state === "sending") {
          message = `Waiting for the last save (${last.said}) before taking it back…`;
          onChange();
        }
        await last.settled;
        if (last.state === "saved" && last.row) {
          try {
            await postJson(`${SESSION}/ab-ratings/${last.row.id}/remove`, {});
          } catch (error) {
            undoError = `${last.said} couldn't be taken back: ${messageOf(error)}`;
            onChange();
            return;
          }
        }
        saves.pop();
        if (last.state === "failed") order.release(last.ids);
        order.undo();
        undoError = null;
        message = `Took back ${last.said}. Choose again.`;
        await showPair();
      }),

    /**
     * Gives up on a rating that failed to save: it leaves the list, and its pair can be drawn
     * again.
     * @param {number} id
     */
    discard: (id) =>
      exclusive(async () => {
        const at = saves.findIndex((save) => save.id === id && save.state === "failed");
        const save = saves[at];
        if (!save) return;
        saves.splice(at, 1);
        order.release(save.ids);
        message = `Dropped ${save.said}; it was never saved.`;
        onChange();
      }),

    /**
     * Switches the order from the next pair on; the pair shown stays.
     * @param {OrderMode} next
     */
    setMode: (next) =>
      exclusive(async () => {
        // The order refuses best questions in an unranked session, before the mode changes.
        order.setMode(next);
        mode = next;
        if (phase === PHASE.done) await showPair();
        else onChange();
      }),
  };
}

/** @typedef {ReturnType<typeof createQuickAbSession>} QuickAbSession */

/**
 * The page's `beforeunload` listener: it asks before leaving while a rating is unsaved.
 * @param {QuickAbSession} session
 * @returns {(event: BeforeUnloadEvent) => void}
 */
export const unloadGuard = (session) => (event) => {
  if (!session.unsaved()) return;
  event.preventDefault();
  // Safari 17 asks only when returnValue is set too.
  event.returnValue = "";
};

// The A/B view (decisions 0027 and 0028): two excerpts side by side in the order the server
// drew, each with its own played tracker, rated a side, a tie or a skip. Time taken runs from
// when the pair is shown.
/** @import { PlayedTracker } from "./played-tracker.js" */
/** @import { StatusLine } from "./status-line.js" */
import { OUTCOMES } from "../domain/rating-values.js";
import { postJson, sessionPath } from "./api.js";
import { seekBy, trackAudio } from "./audio-player.js";
import { elementsById } from "./element-by-id.js";
import { oneAtATime } from "./one-at-a-time.js";
import { createPlayedTracker } from "./played-tracker.js";

const [, , TIE, SKIP] = OUTCOMES;

/**
 * A candidate on one side: its label and the excerpt heard.
 * @typedef {object} AbCandidate
 * @property {string} label
 * @property {{ renderId: number, url: string, duration: number }} excerpt
 */

/**
 * What `POST …/ab-pairs` returns.
 * @typedef {object} AbPair
 * @property {number} a
 * @property {number} b
 * @property {number} orderSeed
 * @property {"a" | "b"} leftSide
 */

/**
 * @typedef {object} Side
 * @property {HTMLAudioElement} audio
 * @property {HTMLElement} box
 * @property {PlayedTracker} tracker
 */

/**
 * @param {{ sessionId: number, status: StatusLine, onClose: () => void, onRated: () => Promise<void> }} options
 */
export function abView({ sessionId, status, onClose, onRated }) {
  const page = elementsById({
    abView: HTMLElement,
    abLeft: HTMLElement,
    abLeftName: HTMLElement,
    abLeftAudio: HTMLAudioElement,
    abLeftReadout: HTMLElement,
    abRight: HTMLElement,
    abRightName: HTMLElement,
    abRightAudio: HTMLAudioElement,
    abRightReadout: HTMLElement,
  });
  const elements = {
    left: {
      box: page.abLeft,
      name: page.abLeftName,
      audio: page.abLeftAudio,
      readout: page.abLeftReadout,
    },
    right: {
      box: page.abRight,
      name: page.abRightName,
      audio: page.abRightAudio,
      readout: page.abRightReadout,
    },
  };
  /** @type {{ pair: AbPair, left: Side, right: Side, active: Side, shownAt: number } | null} */
  let shown = null;
  /** Unwires the sides' audio elements, which every pair reuses. */
  let wiring = new AbortController();

  const current = () => {
    if (!shown) throw new Error("No A/B pair is open.");
    return shown;
  };

  /** @param {Side} side */
  const otherOf = (side) => (side === current().left ? current().right : current().left);

  /** @param {Side} next */
  function activate(next) {
    const { left, right } = current();
    current().active = next;
    left.box.classList.toggle("active-side", next === left);
    right.box.classList.toggle("active-side", next === right);
  }

  /**
   * @param {"left" | "right"} which
   * @param {AbCandidate} candidate
   * @returns {Side}
   */
  function side(which, candidate) {
    const { box, name, audio, readout } = elements[which];
    const tracker = createPlayedTracker(candidate.excerpt.duration);
    name.textContent = candidate.label;
    audio.src = candidate.excerpt.url;
    /** @type {Side} */
    const made = { audio, box, tracker };
    const showPlayed = () => {
      readout.textContent = `Played ${Math.round(tracker.fraction() * 100)}%.`;
    };
    // The handlers run only on playback, after `open` has set `shown`.
    trackAudio(
      audio,
      tracker,
      {
        onPlay: () => {
          otherOf(made).audio.pause();
          activate(made);
        },
        onChange: showPlayed,
        onError: status.fail,
      },
      wiring.signal,
    );
    showPlayed();
    return made;
  }

  /** @param {Side} next */
  async function play(next) {
    activate(next);
    otherOf(next).audio.pause();
    if (next.audio.paused) await next.audio.play();
  }

  function close() {
    if (!shown) return;
    shown.left.audio.pause();
    shown.right.audio.pause();
    wiring.abort();
    shown = null;
    page.abView.hidden = true;
    onClose();
  }

  /** @type {(typeof OUTCOMES)[number] | null} the outcome the guarded `rating` sends */
  let chosen = null;
  // One rating per pair: a second press while the first is posting does nothing.
  const rating = oneAtATime(() => send(/** @type {(typeof OUTCOMES)[number]} */ (chosen)));
  /** @param {(typeof OUTCOMES)[number]} outcome */
  const rate = (outcome) => {
    chosen = outcome;
    return rating();
  };

  /** @param {(typeof OUTCOMES)[number]} outcome */
  async function send(outcome) {
    const { pair, left, right, shownAt } = current();
    const [aSide, bSide] = pair.leftSide === "a" ? [left, right] : [right, left];
    const timeTakenMs = performance.now() - shownAt;
    await postJson(`${sessionPath(sessionId)}/ab-ratings`, {
      a: pair.a,
      b: pair.b,
      orderSeed: pair.orderSeed,
      outcome,
      aPlayedFraction: aSide.tracker.fraction(),
      bPlayedFraction: bSide.tracker.fraction(),
      timeTakenMs,
    });
    close();
    await onRated();
    const played = (/** @type {Side} */ { tracker }) => `${Math.round(tracker.fraction() * 100)}%`;
    status.say(
      `A/B stored as ${outcome}: left played ${played(left)}, right ${played(right)}, ` +
        `${(timeTakenMs / 1000).toFixed(1)} s.`,
    );
  }

  /** @param {boolean} leftWon whether the side shown on the left won */
  const sideWins = (leftWon) => {
    const { leftSide } = current().pair;
    const rightSide = leftSide === "a" ? "b" : "a";
    return rate(leftWon ? leftSide : rightSide);
  };

  return {
    handlers: {
      playLeft: () => play(current().left),
      playRight: () => play(current().right),
      playPause: async () => {
        const { active } = current();
        if (active.audio.paused) await play(active);
        else active.audio.pause();
      },
      back: () => seekBy(current().active.audio, -1),
      forward: () => seekBy(current().active.audio, 1),
      leftWins: () => sideWins(true),
      rightWins: () => sideWins(false),
      tiePair: () => rate(TIE),
      skipPair: () => rate(SKIP),
      closePair: close,
    },
    /**
     * @param {AbPair} pair
     * @param {{ a: AbCandidate, b: AbCandidate }} candidates by the pair's sides
     */
    open(pair, candidates) {
      const [onLeft, onRight] =
        pair.leftSide === "a" ? [candidates.a, candidates.b] : [candidates.b, candidates.a];
      wiring.abort();
      wiring = new AbortController();
      const left = side("left", onLeft);
      const right = side("right", onRight);
      shown = { pair, left, right, active: left, shownAt: performance.now() };
      activate(left);
      page.abView.hidden = false;
      page.abView.scrollIntoView();
    },
  };
}

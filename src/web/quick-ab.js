// The Quick A/B page (decision 0048): the DOM over `quick-ab-session.js`, which holds the pool,
// the order, the save queue and undo. This module wires the two players, the keys and the
// buttons, and renders the session's view after each change. Saves run in the background, so
// what is still saving or failed to save stays on screen until it is resolved, and leaving the
// page asks first. With `&ear` in the address the page is in search-by-ear mode (0055): the
// pairs come from the session's search by ear through `quick-ab-ear.js`, the order switch is
// hidden and Stop ends the search.
/** @import { PlayedTracker } from "./played-tracker.js" */
/** @import { EarState } from "./quick-ab-ear.js" */
/** @import { QuickAbAction } from "./quick-ab-keys.js" */
/** @import { Playable } from "./quick-ab-session.js" */
import { OUTCOMES } from "../domain/rating-values.js";
import { chosenOutcome, SCREEN_SIDES } from "./ab-rating.js";
import { ACTIVE_SIDE } from "./ab-view.js";
import { getJson, VIBES_PATH } from "./api.js";
import { trackAudio } from "./audio-player.js";
import { cloneTemplate } from "./clone-template.js";
import { elementById, elementsById } from "./element-by-id.js";
import { mountPlayer, playAudio, switchPlayback } from "./excerpt-player.js";
import { createPlayedTracker } from "./played-tracker.js";
import { POLL_MS } from "./poll-ms.js";
import { createEarSession, NO_UNDO } from "./quick-ab-ear.js";
import { bindQuickAbKeys, keyLabel, QUICK_AB_KEYS } from "./quick-ab-keys.js";
import { ORDER_MODES } from "./quick-ab-order.js";
import { createQuickAbSession, nameOf, PHASE, unloadGuard } from "./quick-ab-session.js";
import { statusLine } from "./status-line.js";

const [, , TIE, SKIP] = OUTCOMES;
const [CHAMPION, RANDOM, BEST] = ORDER_MODES;
const [LEFT, RIGHT] = SCREEN_SIDES;
/** @typedef {(typeof SCREEN_SIDES)[number]} ScreenSide */

const status = statusLine();
const page = elementsById({
  briefLink: HTMLAnchorElement,
  sessionLink: HTMLAnchorElement,
  modeChampion: HTMLInputElement,
  modeRandom: HTMLInputElement,
  modeBest: HTMLInputElement,
  orderModes: HTMLElement,
  pageTitle: HTMLElement,
  earHelp: HTMLElement,
  stopEar: HTMLButtonElement,
  progressLine: HTMLElement,
  saveLine: HTMLElement,
  retry: HTMLButtonElement,
  failedList: HTMLUListElement,
  pairView: HTMLElement,
  leftBox: HTMLElement,
  leftName: HTMLElement,
  leftAudio: HTMLAudioElement,
  leftPlayed: HTMLElement,
  rightBox: HTMLElement,
  rightName: HTMLElement,
  rightAudio: HTMLAudioElement,
  rightPlayed: HTMLElement,
  doneLine: HTMLElement,
});
/** @type {[HTMLInputElement, (typeof ORDER_MODES)[number]][]} each order's switch */
const modeInputs = [
  [page.modeChampion, CHAMPION],
  [page.modeRandom, RANDOM],
  [page.modeBest, BEST],
];
/** Best questions' title as quick-ab.html has it, and why it is off in an unranked session. */
const BEST_TITLE = page.modeBest.title;
const NO_BEST_TITLE =
  "Turned off because this session isn't ranked by your taste model. Fit it on the Model test page, then ask for candidates on the session page.";
const idText = new URLSearchParams(location.search).get("id");
if (idText === null) throw new Error("quick-ab.html needs ?id=<session id>");
const sessionId = Number(idText);
const earMode = new URLSearchParams(location.search).has("ear");

/** Each action's button, which shows its key and does what the key does. */
const buttons = /** @type {Record<QuickAbAction, HTMLButtonElement>} */ (
  Object.fromEntries(
    Object.entries(QUICK_AB_KEYS).map(([name, code]) => {
      const button = elementById(name, HTMLButtonElement);
      const kbd = document.createElement("kbd");
      kbd.textContent = keyLabel(code);
      button.append(" ", kbd);
      return [name, button];
    }),
  )
);
const choiceButtons = [buttons.chooseLeft, buttons.same, buttons.chooseRight, buttons.skip];

/**
 * @typedef {object} Side
 * @property {HTMLAudioElement} audio
 * @property {HTMLElement} box
 * @property {HTMLElement} name
 * @property {HTMLElement} played
 * @property {PlayedTracker | null} tracker
 */

/** @type {Record<ScreenSide, Side>} */
const sides = {
  left: {
    audio: page.leftAudio,
    box: page.leftBox,
    name: page.leftName,
    played: page.leftPlayed,
    tracker: null,
  },
  right: {
    audio: page.rightAudio,
    box: page.rightBox,
    name: page.rightName,
    played: page.rightPlayed,
    tracker: null,
  },
};
for (const side of Object.values(sides)) mountPlayer(side.audio, status.fail);

/** @type {ScreenSide} the side heard last, which Space and the arrows start from */
let heard = LEFT;
/** Unwires the two audio elements from the last pair's trackers. */
let wiring = new AbortController();
/** The status message last shown. */
let said = "";
/** The pair whose excerpts are on the elements, so a render that keeps it doesn't reload them. */
let wiredPair = /** @type {object | null} */ (null);

const earSession = earMode
  ? createEarSession({
      sessionId,
      now: () => performance.now(),
      pause: () => new Promise((resolve) => setTimeout(resolve, POLL_MS)),
      onChange: render,
    })
  : null;
const session =
  earSession ??
  createQuickAbSession({
    sessionId,
    random: Math.random,
    now: () => performance.now(),
    onChange: render,
    onError: status.fail,
  });
page.orderModes.hidden = earMode;
page.earHelp.hidden = !earMode;
page.stopEar.hidden = !earMode;
if (earMode) {
  page.pageTitle.textContent = "Search by ear";
  buttons.undo.disabled = true;
  buttons.undo.title = NO_UNDO;
}

/** @param {Side} side */
const showPlayed = (side) => {
  side.played.textContent = `Played ${Math.round((side.tracker?.fraction() ?? 0) * 100)}%.`;
};

/** @param {ScreenSide} which */
function hear(which) {
  heard = which;
  sides.left.box.classList.toggle(ACTIVE_SIDE, which === LEFT);
  sides.right.box.classList.toggle(ACTIVE_SIDE, which === RIGHT);
}

/**
 * Puts the pair's excerpts on the two elements with fresh trackers.
 * @param {{ left: Playable, right: Playable }} shown
 */
function wire(shown) {
  wiring.abort();
  wiring = new AbortController();
  for (const [which, other] of /** @type {const} */ ([
    [LEFT, RIGHT],
    [RIGHT, LEFT],
  ])) {
    const side = sides[which];
    const candidate = shown[which];
    side.audio.pause();
    side.name.textContent = nameOf(candidate.id);
    side.audio.src = candidate.excerpt.url;
    const tracker = createPlayedTracker(candidate.excerpt.duration);
    side.tracker = tracker;
    trackAudio(
      side.audio,
      tracker,
      {
        onPlay: () => {
          sides[other].audio.pause();
          hear(which);
        },
        onChange: () => showPlayed(side),
        onError: status.fail,
      },
      wiring.signal,
    );
    showPlayed(side);
  }
  hear(LEFT);
}

function render() {
  const view = session.view();
  const pairUp = view.phase === PHASE.pair && view.shown !== null;
  for (const button of choiceButtons) button.disabled = !pairUp;
  if (view.shown && view.shown.pair !== wiredPair) {
    wiredPair = view.shown.pair;
    wire(view.shown);
  }
  if (!view.shown) {
    wiredPair = null;
    for (const side of Object.values(sides)) side.audio.pause();
  }
  page.pairView.hidden = !view.shown;
  for (const [input, mode] of modeInputs) input.checked = view.mode === mode;
  page.modeBest.disabled = !view.bestAvailable;
  page.modeBest.title = view.bestAvailable ? BEST_TITLE : NO_BEST_TITLE;

  const left = view.remaining;
  // Only the search-by-ear session's view has it.
  const ear = /** @type {{ ear?: EarState | null }} */ (view).ear ?? null;
  page.stopEar.disabled = ear === null || ear.phase === "done" || ear.stopped;
  page.progressLine.textContent =
    view.phase === PHASE.done
      ? ""
      : ear
        ? `Pair ${ear.query + 1} of ${ear.budget}.` +
          (view.champion === null
            ? ""
            : ` The one that stays is the best so far: ${nameOf(view.champion)}.`)
        : view.mode === RANDOM || view.mode === BEST
          ? `${left} pair${left === 1 ? "" : "s"} not yet rated, this one included.`
          : `${left} challenger${left === 1 ? "" : "s"} still to come, this one included.` +
            (view.champion === null ? "" : ` The one that stays: ${nameOf(view.champion)}.`);

  page.doneLine.hidden = view.phase !== PHASE.done;
  const best = view.champion === null ? "" : ` The last one chosen is ${nameOf(view.champion)}.`;
  page.doneLine.textContent = ear
    ? earDoneText(ear)
    : view.poolSize < 2
      ? "This session has fewer than two candidates with an excerpt, so there is nothing to compare. Ask for candidates on the session page first."
      : view.mode === RANDOM
        ? `Every pair has been rated.${best} Undo takes the last choice back.`
        : view.mode === BEST
          ? `Every pair the taste model can order has been rated.${best} Choose Random pairs to keep comparing.`
          : `Every candidate has had a turn.${best} Choose Random pairs to keep comparing.`;

  const problems = [view.pairError, view.undoError].filter(Boolean);
  const saving =
    view.saving > 0 ? `Saving ${view.saving} choice${view.saving === 1 ? "" : "s"}…` : "";
  page.saveLine.textContent = [saving, ...problems].filter(Boolean).join(" ");
  page.saveLine.classList.toggle("errors", problems.length > 0);
  page.failedList.replaceChildren(
    ...view.failed.map(({ id, said, error }) => {
      const item = cloneTemplate("failed-save", {
        line: HTMLElement,
        discard: HTMLButtonElement,
      });
      item.line.textContent = `${said} wasn't saved: ${error}`;
      item.discard.onclick = () => status.run(() => session.discard(id));
      return item.root;
    }),
  );
  page.retry.hidden = view.failed.length === 0 && view.pairError === null;
  // Only a new message replaces the status line, so a player's error stays until the next one.
  if (view.message !== said) {
    said = view.message;
    status.say(said);
  }
}

/**
 * What the done line says of a search by ear that ended.
 * @param {EarState} ear
 */
function earDoneText({ answered, best, stopped, error }) {
  const choices = `${answered} choice${answered === 1 ? "" : "s"}`;
  const kept =
    best === null
      ? ""
      : ` Its best is ${nameOf(best.id)}, shown first in its fold on the session page.`;
  if (error !== null) return `The search by ear stopped after ${choices}: ${error}${kept}`;
  const how = stopped ? "You stopped the search by ear" : "The search by ear asked every pair";
  return `${how} after ${choices}.${kept}`;
}

const played = () => ({
  left: sides.left.tracker?.fraction() ?? 0,
  right: sides.right.tracker?.fraction() ?? 0,
});

/** @param {(typeof OUTCOMES)[number]} outcome */
const choose = (outcome) => status.run(() => session.choose(outcome, played()));

/** @param {ScreenSide} which */
function chooseSide(which) {
  const { shown } = session.view();
  if (shown) choose(chosenOutcome(shown.pair, which));
}

/** @param {ScreenSide} which */
function play(which) {
  if (!session.view().shown) return;
  switchPlayback(sides[heard].audio, sides[which].audio, status.fail);
  hear(which);
}

function playPause() {
  if (!session.view().shown) return;
  const { audio } = sides[heard];
  if (audio.paused) playAudio(audio, status.fail);
  else audio.pause();
}

/** @type {Record<QuickAbAction, () => void>} */
const actions = {
  playLeft: () => play(LEFT),
  playRight: () => play(RIGHT),
  chooseLeft: () => chooseSide(LEFT),
  chooseRight: () => chooseSide(RIGHT),
  same: () => choose(TIE),
  skip: () => choose(SKIP),
  playPause,
  undo: () => status.run(session.undo),
};
bindQuickAbKeys(document, actions, () => document.activeElement);
for (const [name, button] of Object.entries(buttons)) {
  button.onclick = actions[/** @type {QuickAbAction} */ (name)];
}
page.retry.onclick = () => status.run(session.retry);
page.stopEar.onclick = () => {
  if (earSession) status.run(earSession.stop);
};
for (const [input, mode] of modeInputs) {
  input.onchange = () => {
    if (input.checked) status.run(() => session.setMode(mode));
  };
}
window.addEventListener("beforeunload", unloadGuard(session));

status.run(async () => {
  const { vibeId } = await session.load();
  const vibe = await getJson(`${VIBES_PATH}/${vibeId}`);
  page.briefLink.href = `./brief.html?id=${vibeId}`;
  page.briefLink.textContent = vibe.revision.name;
  page.sessionLink.href = `./session.html?id=${sessionId}`;
  page.sessionLink.textContent = `Session ${sessionId}`;
  const name = earMode ? "Search by ear" : "Quick A/B";
  document.title = `${name}, session ${sessionId}, ${vibe.revision.name} · Ambient Studio`;
});

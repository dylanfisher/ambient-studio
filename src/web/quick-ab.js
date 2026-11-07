// The Quick A/B page (decision 0048): a session's candidates in pairs, one after another, rated
// with keys or buttons. The order comes from `quick-ab-order.js`, each pair's sides from the
// server's logged seed (0027), and each rating goes through the session's A/B rating route,
// so the training sets read it like any other (0043). The next pair is shown while the rating
// is saved, since keeping the rated audio renders the excerpt again (0.8–2.3 s measured).
/** @import { AbPair } from "./ab-view.js" */
/** @import { Outcome } from "./ab-rating.js" */
/** @import { PlayedTracker } from "./played-tracker.js" */
/** @import { QuickAbAction } from "./quick-ab-keys.js" */
import { OUTCOMES } from "../domain/rating-values.js";
import { abRatingBody, chosenOutcome, SCREEN_SIDES } from "./ab-rating.js";
import { ACTIVE_SIDE } from "./ab-view.js";
import { getJson, postJson, sessionPath, VIBES_PATH } from "./api.js";
import { trackAudio } from "./audio-player.js";
import { elementById, elementsById } from "./element-by-id.js";
import { mountPlayer, switchPlayback } from "./excerpt-player.js";
import { oneAtATime } from "./one-at-a-time.js";
import { outcomeText } from "./outcome-text.js";
import { createPlayedTracker } from "./played-tracker.js";
import { bindQuickAbKeys, keyLabel, QUICK_AB_KEYS } from "./quick-ab-keys.js";
import { createQuickAbOrder, ORDER_MODES } from "./quick-ab-order.js";
import { statusLine } from "./status-line.js";

const [A, B, TIE, SKIP] = OUTCOMES;
const [CHAMPION, RANDOM] = ORDER_MODES;
const [LEFT, RIGHT] = SCREEN_SIDES;
/** @typedef {(typeof SCREEN_SIDES)[number]} ScreenSide */

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  sessionLink: HTMLAnchorElement,
  randomSwitch: HTMLInputElement,
  progressLine: HTMLElement,
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
const idText = new URLSearchParams(location.search).get("id");
if (idText === null) throw new Error("quick-ab.html needs ?id=<session id>");
const sessionId = Number(idText);
const SESSION = sessionPath(sessionId);

/** Each action's button, which shows its key and does what the key does. */
const buttons = /** @type {Record<QuickAbAction, HTMLButtonElement>} */ (
  Object.fromEntries(
    Object.entries(QUICK_AB_KEYS).map(([name, key]) => {
      const button = elementById(name, HTMLButtonElement);
      const kbd = document.createElement("kbd");
      kbd.textContent = keyLabel(key);
      button.append(" ", kbd);
      return [name, button];
    }),
  )
);
const choiceButtons = [buttons.chooseLeft, buttons.same, buttons.chooseRight, buttons.skip];

/**
 * A candidate as `GET …/candidates` lists it, with what this page reads.
 * @typedef {{ id: number, excerpt: Excerpt | null }} Candidate
 */

/** @typedef {{ renderId: number, url: string, duration: number }} Excerpt */
/** @typedef {{ id: number, excerpt: Excerpt }} Playable */

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

/**
 * The candidates Quick A/B draws from: those with an excerpt to play. 4j's hidden candidates
 * are left out here (0048).
 * @param {Candidate[]} candidates
 */
const poolOf = (candidates) =>
  candidates.filter(
    /** @returns {candidate is Playable} */ (candidate) => candidate.excerpt !== null,
  );

/** @type {Map<number, Playable>} */
const pool = new Map();
/** @type {ReturnType<typeof createQuickAbOrder>} */
let order = createQuickAbOrder([], { mode: CHAMPION, random: Math.random });
/** @type {{ pair: AbPair, ids: [number, number], shownAt: number } | null} the pair on the page */
let shown = null;
/** @type {ScreenSide} the side heard last, which Space and the arrows start from */
let heard = LEFT;
/** Unwires the two audio elements from the last pair's trackers. */
let wiring = new AbortController();
/** Ratings are sent one after another, so the server renders one rated excerpt at a time. */
let saving = Promise.resolve();
/**
 * Each rating made on the page, newest last, with its stored row once saved, or null when it
 * failed; Undo takes the last one back.
 * @type {{ stored: Promise<{ id: number } | null>, said: string }[]}
 */
const made = [];

/** @param {number} id */
const nameOf = (id) => `Candidate #${id}`;

/** @param {Side} side */
const showPlayed = (side) => {
  const fraction = side.tracker?.fraction() ?? 0;
  side.played.textContent = `Played ${Math.round(fraction * 100)}%.`;
};

/** @param {ScreenSide} which */
function hear(which) {
  heard = which;
  sides.left.box.classList.toggle(ACTIVE_SIDE, which === LEFT);
  sides.right.box.classList.toggle(ACTIVE_SIDE, which === RIGHT);
}

function showProgress() {
  const left = order.remaining();
  const champion = order.champion();
  page.progressLine.textContent =
    order.mode() === RANDOM
      ? `${left} pair${left === 1 ? "" : "s"} not yet rated, this one included.`
      : `${left} challenger${left === 1 ? "" : "s"} still to come, this one included.` +
        (champion === null ? "" : ` The one that stays: ${nameOf(champion)}.`);
}

/** Shows the order's pair, drawing its sides from the server, or says the pool has run out. */
async function showPair() {
  wiring.abort();
  wiring = new AbortController();
  for (const side of Object.values(sides)) side.audio.pause();
  shown = null;
  showProgress();
  const ids = order.pair();
  for (const button of choiceButtons) button.disabled = ids === null;
  if (ids === null) {
    page.pairView.hidden = true;
    page.doneLine.hidden = false;
    const champion = order.champion();
    const best = champion === null ? "" : ` The last one chosen is ${nameOf(champion)}.`;
    page.doneLine.textContent =
      pool.size < 2
        ? "This session has fewer than two candidates with an excerpt, so there is nothing to compare. Ask for candidates on the session page first."
        : order.mode() === RANDOM
          ? `Every pair has been rated.${best} Undo takes the last choice back.`
          : `Every candidate has had a turn.${best} Turn on Random pairs to keep comparing.`;
    return;
  }
  const a = pool.get(ids[0]);
  const b = pool.get(ids[1]);
  if (!a || !b)
    throw new Error(`the pair ${ids[0]} and ${ids[1]} names a candidate not in the pool`);
  /** @type {AbPair} */
  const pair = await postJson(`${SESSION}/ab-pairs`, {
    a: a.excerpt.renderId,
    b: b.excerpt.renderId,
  });
  const onSide = pair.leftSide === "a" ? { left: a, right: b } : { left: b, right: a };
  for (const [which, side] of /** @type {const} */ ([
    [LEFT, sides.left],
    [RIGHT, sides.right],
  ])) {
    const candidate = onSide[which];
    const other = which === LEFT ? sides.right : sides.left;
    side.name.textContent = nameOf(candidate.id);
    side.audio.src = candidate.excerpt.url;
    const tracker = createPlayedTracker(candidate.excerpt.duration);
    side.tracker = tracker;
    trackAudio(
      side.audio,
      tracker,
      {
        onPlay: () => {
          other.audio.pause();
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
  page.doneLine.hidden = true;
  page.pairView.hidden = false;
  shown = { pair, ids, shownAt: performance.now() };
}

/**
 * What a choice says, by the candidates' names.
 * @param {Outcome} outcome
 * @param {[number, number]} ids the pair's sides a and b
 */
function choiceText(outcome, [a, b]) {
  if (outcome === A) return `${nameOf(a)} over ${nameOf(b)}`;
  if (outcome === B) return `${nameOf(b)} over ${nameOf(a)}`;
  // Not a side, so outcomeText reads it without the order.
  return `${nameOf(a)} against ${nameOf(b)}, ${outcomeText({ outcome, leftSide: A })}`;
}

/** @type {() => Promise<void>} the work the guarded `runOne` does next */
let work = async () => {};
// A choice, an undo and a switch of order each change the pair, so one runs at a time: a key
// pressed while the next pair loads does nothing.
const runOne = oneAtATime(() => work());
/** @param {() => Promise<void>} next */
const exclusive = (next) => {
  work = next;
  return status.run(runOne);
};

/**
 * Saves the rating in the background and shows the next pair at once.
 * @param {Outcome} outcome
 */
async function rate(outcome) {
  if (!shown) return;
  const { pair, ids, shownAt } = shown;
  const played = {
    left: sides.left.tracker?.fraction() ?? 0,
    right: sides.right.tracker?.fraction() ?? 0,
  };
  const body = abRatingBody(pair, outcome, played, performance.now() - shownAt);
  const said = choiceText(outcome, ids);
  const post = saving.then(() => postJson(`${SESSION}/ab-ratings`, body));
  const stored = post.then(
    (row) => row,
    (error) => {
      status.fail(new Error(`${said} wasn't saved: ${error.message}`, { cause: error }));
      return null;
    },
  );
  // A failed rating is reported above; the ones after it are still sent.
  saving = stored.then(() => undefined);
  made.push({ stored, said });
  order.rate(outcome);
  status.say(`Chose ${said}.`);
  await showPair();
}
/** @param {Outcome} outcome */
const choose = (outcome) => exclusive(() => rate(outcome));
/** @param {ScreenSide} which */
const chooseSide = (which) => (shown ? choose(chosenOutcome(shown.pair, which)) : undefined);

async function undo() {
  const last = made.pop();
  if (!last) {
    status.say("There is no choice to undo.");
    return;
  }
  const row = await last.stored;
  if (row) await postJson(`${SESSION}/ab-ratings/${row.id}/remove`, {});
  order.undo();
  page.randomSwitch.checked = order.mode() === RANDOM;
  await showPair();
  status.say(`Took back ${last.said}. Choose again.`);
}

/** @param {ScreenSide} which */
function play(which) {
  if (!shown) return;
  switchPlayback(sides[heard].audio, sides[which].audio).catch(status.fail);
  hear(which);
}

function playPause() {
  if (!shown) return;
  const { audio } = sides[heard];
  if (audio.paused) audio.play().catch(status.fail);
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
  undo: () => exclusive(undo),
};
bindQuickAbKeys(document, actions, () => document.activeElement);
for (const [name, button] of Object.entries(buttons)) {
  button.onclick = actions[/** @type {QuickAbAction} */ (name)];
}
page.randomSwitch.onchange = () =>
  exclusive(async () => {
    order.setMode(page.randomSwitch.checked ? RANDOM : CHAMPION);
    await showPair();
  });

status.run(async () => {
  const session = await getJson(SESSION);
  const vibe = await getJson(`${VIBES_PATH}/${session.vibeId}`);
  page.briefLink.href = `./brief.html?id=${session.vibeId}`;
  page.briefLink.textContent = vibe.revision.name;
  page.sessionLink.href = `./session.html?id=${sessionId}`;
  page.sessionLink.textContent = `Session ${sessionId}`;
  document.title = `Quick A/B, session ${sessionId}, ${vibe.revision.name} · Ambient Studio`;
  const { candidates } = await getJson(`${SESSION}/candidates`);
  for (const candidate of poolOf(candidates)) pool.set(candidate.id, candidate);
  order = createQuickAbOrder([...pool.keys()], { mode: CHAMPION, random: Math.random });
  await showPair();
  status.say(
    shown
      ? `${pool.size} candidates to compare. Press ← or → to listen, then A or D to choose.`
      : "Nothing to compare yet.",
  );
});

// The session page (decisions 0028 and 0032): the candidate table, one row per candidate with
// its excerpt, its rating controls and, behind More controls, the rest; the A/B view; and the
// session's jobs, each with its progress, followed until they finish. A candidate's row sits
// under the one it was made from, carries its A/B marks, and can be hidden into the hidden
// panel, and the page keeps its scroll across a trip to Quick A/B or the A/B view (0049). Of a
// revised pair, one row shows and links the other (0036). Each row also reads its features
// against its brief's ranges, locks its values (0035), and explores or nudges from it (0039).
// In a session ranked by the brief's taste model, the rows follow the ranking with each score,
// and Best question opens the pair the model is least sure of (0046).
// Played fraction and time taken are measured here as decision 0027 defines them. A "card" in
// this file is one candidate's row and its More controls, a `<tbody>` of the table.
/** @import { FeatureRanges } from "../domain/target-schema.js" */
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { AbCandidate } from "./ab-view.js" */
/** @import { CardHold } from "./card-hold.js" */
/** @import { JobStatus } from "./job-progress.js" */
/** @import { PlayedTracker } from "./played-tracker.js" */
/** @import { StartJob, SteerControls } from "./steer-controls.js" */
import { featuresText } from "../domain/features-text.js";
import { macroTitles } from "../domain/macro-words.js";
import { OPERATOR } from "../domain/operator.js";
import { MACRO_DIRECTIONS, THUMBS } from "../domain/rating-values.js";
import { validateTargets } from "../domain/validate-targets.js";
import { MACROS } from "../engine/genome-schema.js";
import { abMarks, markText } from "./ab-marks.js";
import { abView } from "./ab-view.js";
import { getJson, jobPath, postJson, sessionPath, startJob, VIBES_PATH } from "./api.js";
import { trackAudio } from "./audio-player.js";
import { questionOf } from "./best-question.js";
import { candidateRows } from "./candidate-rows.js";
import { createSelection } from "./candidate-selection.js";
import { createCardHold } from "./card-hold.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { mountPlayer } from "./excerpt-player.js";
import { followJob } from "./follow-job.js";
import { jobControl } from "./job-control.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox, TONE } from "./job-view.js";
import { lockChoices } from "./lock-choices.js";
import { macroOffer } from "./macro-offer.js";
import { oneAtATime } from "./one-at-a-time.js";
import { intentText, originText, rejectText } from "./origin-text.js";
import { createPairSwap } from "./pair-swap.js";
import { createPlayedTracker } from "./played-tracker.js";
import { createQuickAbOrder, ORDER_MODES, ratedPairKeys } from "./quick-ab-order.js";
import { rangesReadout } from "./ranges-readout.js";
import { rankText } from "./rank-text.js";
import { keepOnClick, scrollMemory } from "./scroll-memory.js";
import { statusLine } from "./status-line.js";
import { steerControls } from "./steer-controls.js";

const [UP, DOWN] = THUMBS;
const [MORE, LESS] = MACRO_DIRECTIONS;
const [, , BEST] = ORDER_MODES;
const MACRO_NAMES = Object.keys(MACROS);

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  lineageLink: HTMLAnchorElement,
  quickAbLink: HTMLAnchorElement,
  bestQuestionButton: HTMLButtonElement,
  countInput: HTMLInputElement,
  askButton: HTMLButtonElement,
  excerptsButton: HTMLButtonElement,
  stopButton: HTMLButtonElement,
  jobBox: HTMLElement,
  gridView: HTMLElement,
  candidateTable: HTMLTableElement,
  hiddenBox: HTMLElement,
  hiddenSummary: HTMLElement,
  hiddenTable: HTMLTableElement,
  noCandidates: HTMLElement,
  rejectedBox: HTMLElement,
  rejectedSummary: HTMLElement,
  rejectedList: HTMLUListElement,
});
const idText = new URLSearchParams(location.search).get("id");
if (idText === null) throw new Error("session.html needs ?id=<session id>");
const sessionId = Number(idText);
const SESSION = sessionPath(sessionId);
/** What the page says before the session has a candidate, as session.html has it. */
const NO_CANDIDATES = page.noCandidates.textContent;

/** The parts of a candidate's row in session.html. */
const CARD_PARTS = Object.freeze({
  nameCell: HTMLElement,
  branch: HTMLElement,
  heading: HTMLElement,
  rowId: HTMLElement,
  thumbsBadge: HTMLElement,
  sketchBadge: HTMLElement,
  rankBadge: HTMLElement,
  wildcardBadge: HTMLElement,
  intent: HTMLElement,
  origin: HTMLElement,
  rangesBox: HTMLElement,
  rangesLine: HTMLElement,
  ranges: HTMLUListElement,
  audio: HTMLAudioElement,
  missing: HTMLElement,
  played: HTMLElement,
  up: HTMLButtonElement,
  down: HTMLButtonElement,
  compare: HTMLButtonElement,
  hide: HTMLButtonElement,
  expand: HTMLButtonElement,
  moreRow: HTMLElement,
  abBadge: HTMLElement,
  wins: HTMLElement,
  losses: HTMLElement,
  macros: HTMLElement,
  note: HTMLTextAreaElement,
  tags: HTMLInputElement,
  sketch: HTMLButtonElement,
  features: HTMLElement,
  lint: HTMLElement,
  findings: HTMLUListElement,
  pairLink: HTMLButtonElement,
  steer: HTMLElement,
  lockSummary: HTMLElement,
  lockPath: HTMLSelectElement,
  lock: HTMLButtonElement,
  offer: HTMLElement,
  offerText: HTMLElement,
  offerYes: HTMLButtonElement,
  offerNo: HTMLButtonElement,
  locksLine: HTMLElement,
  lockList: HTMLUListElement,
});

/** @typedef {{ less: HTMLButtonElement, clear: HTMLButtonElement, more: HTMLButtonElement }} MacroButtons */

/**
 * A candidate as `GET …/candidates` returns it, with a genome.
 * @typedef {object} Candidate
 * @property {number} id
 * @property {number} genomeId
 * @property {number} seed
 * @property {number} vibeRevisionId the brief version it was made under, whose ranges it is
 *   read against, as the revision pass and the shown-card rule read it (decision 0036)
 * @property {string | null} intent
 * @property {string | null} operator
 * @property {any} operatorParams
 * @property {number[]} parentIds
 * @property {string | null} rejectReason
 * @property {any} genome null for a rejected candidate
 * @property {LintResult | null} lint
 * @property {{ renderId: number, url: string, duration: number, features: any, checks: LintResult } | null} excerpt
 * @property {{ thumbs: { id: number, direction: string, note: string | null } | null, macros: Record<string, { id: number, direction: string }> }} feedback
 *   the live choices, one per thumbs and per macro (decision 0031)
 * @property {{ firstTryId: number, revisionId: number, shownId: number } | null} pair a first
 *   try and its revision, and which the server would show (decision 0036)
 * @property {boolean} hidden whether the owner hid it (decision 0049)
 * @property {{ rank: number, score: number, wildcard: boolean, slot: number } | null} ranking
 *   where its excerpt sits in the ranking, null when it has none (decision 0046)
 */

/**
 * A candidate's row in the table. It is updated in place when its excerpt lands, so a note
 * being typed in it keeps its text and the focus.
 * @typedef {object} Card
 * @property {Candidate} candidate
 * @property {string} label "Candidate 3", numbered among the session's first tries from 1, or
 *   "Candidate 3, revised" for first try 3's revision, as its heading, the A/B view and the
 *   status line name it
 * @property {ReturnType<typeof cloneTemplate<typeof CARD_PARTS>>} parts
 * @property {Record<string, MacroButtons>} macros
 * @property {PlayedTracker | null} tracker null without an excerpt
 * @property {AbortController} wiring unwires the audio element from the tracker
 * @property {boolean} busy whether a rating of it is being sent
 * @property {CardHold} hold whether it is in use, which holds its pair's swap
 * @property {SteerControls} steer its explore and nudge controls
 * @property {string[]} offered the macro lock paths its lock control offers; none while the
 *   offer is hidden
 * @property {boolean} locking whether a lock change from it is being sent
 */

/** @type {any} */
let session;
/** @type {Card[]} in the order the session made them */
let cards = [];
/** @type {import("./candidate-selection.js").Selection<Card>} */
const selection = createSelection(() => performance.now());
const pairSwap = createPairSwap();
/** @type {Card | null} the first of an A/B pair, once marked */
let marked = null;
/** @type {{ ratings: any[], sketches: any[] }} */
let rated = { ratings: [], sketches: [] };
/** @type {import("./best-question.js").PairRanking | null} the session's ranking (0046) */
let ranking = null;
/** @type {{ id: number, path: string, candidateId: number }[]} the brief's live locks */
let locks = [];
/** @type {Map<number, FeatureRanges>} each brief version's ranges, by its id */
const rangesByRevision = new Map();
/** @type {Map<number, JobStatus>} every job followed, by id, as last read */
const jobs = new Map();
/** @type {Map<number, ReturnType<typeof jobBox>>} */
const boxes = new Map();
const ask = jobControl(page.askButton);
const excerpts = jobControl(page.excerptsButton);
/** Whether a job's POST is in flight, so the controls stay off until its job id is known. */
let posting = false;

/** @param {number} fraction */
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/** The titles controls had before being turned off, to give back when turned on. */
const idleTitles = new WeakMap();

/**
 * @param {HTMLButtonElement} button
 * @param {string | null} why null turns it on; otherwise it is off and its title says why
 */
function offBecause(button, why) {
  if (!idleTitles.has(button)) idleTitles.set(button, button.title);
  button.disabled = why !== null;
  button.title = why ?? idleTitles.get(button);
}

/**
 * @param {HTMLUListElement} list
 * @param {LintResult["findings"]} findings
 */
function showFindings(list, findings) {
  list.replaceChildren(
    ...findings.map(({ rule, path, message }) => {
      const item = document.createElement("li");
      item.textContent = `${rule} at ${path}: ${message}`;
      return item;
    }),
  );
}

/** @param {Card} card */
const choicesOf = (card) => card.candidate.feedback;

/** @param {Card} card */
function showPlayed(card) {
  if (!card.tracker) return;
  card.parts.played.textContent = `Played ${percent(card.tracker.fraction())}.`;
}

/** @param {number} count */
const times = (count) => (count === 1 ? "once" : `${count} times`);

/**
 * The card's A/B marks: whether it was compared in this session at all, and a mark per live
 * win and per live loss (decision 0049).
 * @param {Card} card
 */
function showMarks(card) {
  const { wins, losses, compared } = abMarks(rated.ratings, sessionId, card.candidate);
  const { abBadge } = card.parts;
  abBadge.textContent = compared === 0 ? "Not compared" : `Compared ${compared}`;
  abBadge.className = compared === 0 ? "badge muted" : "badge";
  abBadge.title =
    compared === 0
      ? "Not yet in an A/B comparison of this session."
      : `In ${compared} A/B comparison${compared === 1 ? "" : "s"} of this session, ties and skips included.`;
  for (const [part, count, words] of /** @type {const} */ ([
    [card.parts.wins, wins, ["▲", "Chosen"]],
    [card.parts.losses, losses, ["▼", "Not chosen"]],
  ])) {
    part.hidden = count === 0;
    part.textContent = markText(count, words[0]);
    const said = `${words[1]} ${times(count)} in A/B.`;
    part.title = said;
    part.ariaLabel = said;
  }
}

/**
 * Where the card sits in the ranking, its score, and whether it is a wildcard.
 * @param {Card} card
 */
function showRank(card) {
  const place = card.candidate.ranking;
  const { rankBadge, wildcardBadge } = card.parts;
  rankBadge.hidden = place === null || ranking === null;
  wildcardBadge.hidden = place === null || ranking === null || !place.wildcard;
  if (place === null || ranking === null) return;
  const shown = rankText(place, ranking.renderIds.length);
  rankBadge.textContent = shown.text;
  rankBadge.title = shown.title;
  wildcardBadge.title = shown.wildcard ?? "";
}

/**
 * Shows the card's controls as the server last confirmed them: its live thumbs, one choice per
 * macro, and whether it is kept as a sketch.
 * @param {Card} card
 */
function showRated(card) {
  const { thumbs, macros } = choicesOf(card);
  const { parts } = card;
  parts.up.setAttribute("aria-pressed", String(thumbs?.direction === UP));
  parts.down.setAttribute("aria-pressed", String(thumbs?.direction === DOWN));
  parts.thumbsBadge.hidden = thumbs === null;
  parts.thumbsBadge.textContent = thumbs?.direction === UP ? "Thumbs up" : "Thumbs down";
  parts.thumbsBadge.className = `badge ${thumbs?.direction === UP ? TONE.good : TONE.bad}`;
  for (const [macro, buttons] of Object.entries(card.macros)) {
    const direction = macros[macro]?.direction ?? null;
    buttons.less.setAttribute("aria-pressed", String(direction === LESS));
    buttons.clear.setAttribute("aria-pressed", String(direction === null));
    buttons.more.setAttribute("aria-pressed", String(direction === MORE));
  }
  parts.sketchBadge.hidden = !rated.sketches.some((row) => row.candidateId === card.candidate.id);
  showRank(card);
  showPlayed(card);
  showMarks(card);
}

/** @param {Card} card */
const ratingButtons = (card) => [
  card.parts.up,
  card.parts.down,
  card.parts.sketch,
  card.parts.compare,
  ...Object.values(card.macros).flatMap(({ less, clear, more }) => [less, clear, more]),
];

/** What a card's hide button says and does, by whether the card is hidden now. */
const HIDE_BUTTON = Object.freeze({
  shown: {
    text: "Hide",
    title:
      "Hides this candidate: it moves to Hidden candidates at the bottom of the page and leaves Quick A/B. Its ratings are kept, and the lineage page still shows it.",
  },
  hidden: {
    text: "Show again",
    title:
      "Shows this candidate in the table again, under the one it was made from, and puts it back in Quick A/B.",
  },
});

/** Turns every card's rating controls on or off, saying why when off. */
function showCardControls() {
  const stopped = session?.stoppedAt !== null;
  for (const card of cards) {
    const why = stopped
      ? "This session is stopped, so it takes no more ratings. Start a new session from the brief page."
      : !card.candidate.excerpt
        ? "Turned off until this candidate's excerpt is rendered, so that you rate what you heard."
        : card.busy
          ? "Turned off while your last choice for this candidate is saved."
          : null;
    for (const button of ratingButtons(card)) offBecause(button, why);
    if (why === null && card.candidate.hidden) {
      offBecause(
        card.parts.compare,
        "Turned off because this candidate is hidden, so it isn't compared. Press Show again first.",
      );
    }
    // Hiding is not a rating: a stopped session, or a card with no excerpt, can hide.
    const hide = card.candidate.hidden ? HIDE_BUTTON.hidden : HIDE_BUTTON.shown;
    card.parts.hide.textContent = hide.text;
    card.parts.hide.disabled = card.busy;
    card.parts.hide.title = card.busy
      ? "Turned off while your last change to this candidate is saved."
      : hide.title;
    card.steer.off(
      stopped
        ? "This session is stopped, so it takes no more jobs. Explore or nudge from the lineage page, or start a new session from the brief page."
        : null,
    );
  }
}

/**
 * The owner chose the card by playing it or using one of its controls. The focus stays where
 * it is (decision 0032).
 * @param {Card} card
 */
function choose(card) {
  const before = selection.current();
  selection.choose(card);
  if (before === card) return;
  before?.parts.root.classList.remove("selected");
  card.parts.root.classList.add("selected");
}

/**
 * The card's features against the ranges of the brief version it was made under, each miss
 * marked in words as well as color, and the render checks it fails.
 * @param {Card} card
 */
function showRanges(card) {
  const { parts, candidate } = card;
  const ranges = rangesByRevision.get(candidate.vibeRevisionId);
  if (!ranges) {
    throw new Error(`${card.label} names brief version ${candidate.vibeRevisionId}, not loaded`);
  }
  const { excerpt } = candidate;
  parts.rangesBox.hidden =
    !excerpt || (Object.keys(ranges).length === 0 && excerpt.checks.findings.length === 0);
  if (!excerpt) return;
  const readout = rangesReadout(excerpt.features, ranges, excerpt.checks);
  parts.rangesLine.textContent = readout.text;
  parts.ranges.replaceChildren(
    ...readout.rows.map((row) => {
      const item = document.createElement("li");
      item.className = row.miss ? "miss" : "inside";
      item.textContent = `${row.miss ? "Misses" : "Inside"}: ${row.label} ${row.value}, aiming ${row.range}`;
      return item;
    }),
  );
}

/** Reads the ranges of every version of the brief, for the cards made under each. */
async function loadRanges() {
  /** @type {{ revisions: { id: number, softTargets: unknown }[] }} */
  const { revisions } = await getJson(`${VIBES_PATH}/${session.vibeId}/revisions`);
  for (const revision of revisions) {
    const checked = validateTargets(revision.softTargets);
    if (!checked.ok) {
      const why = checked.errors.map((error) => error.message).join("; ");
      throw new Error(`brief version ${revision.id} has ranges the page can't read: ${why}`);
    }
    rangesByRevision.set(revision.id, checked.ranges);
  }
}

/**
 * How a card names another candidate: by its card's label in this session, or by its id.
 * @param {number} id
 */
function nameOf(id) {
  const card = cards.find((shown) => shown.candidate.id === id);
  return card ? card.label.toLowerCase() : `candidate #${id} of another session`;
}

/** The brief's locks route. */
const locksPath = () => `${VIBES_PATH}/${session.vibeId}/locks`;

/** Reads the brief's live locks and shows them on every card. */
async function loadLocks() {
  ({ locks } = await getJson(locksPath()));
  for (const card of cards) showLocks(card);
}

/**
 * The brief's locks on the card, each with Unlock, and the card's offer to lock the macros.
 * @param {Card} card
 */
function showLocks(card) {
  const { parts } = card;
  parts.lockSummary.textContent = locks.length === 0 ? "Locks" : `Locks (${locks.length})`;
  parts.locksLine.textContent =
    locks.length === 0
      ? "The brief has no locks yet."
      : "The brief's locks, which every later candidate keeps:";
  parts.lockList.replaceChildren(
    ...locks.map((lock) => {
      const item = cloneTemplate("lock-item", { line: HTMLElement, unlock: HTMLButtonElement });
      const from =
        lock.candidateId === card.candidate.id ? "this candidate" : nameOf(lock.candidateId);
      item.line.textContent = `${lock.path}, as ${from} has it`;
      item.unlock.onclick = () => status.run(() => unlock(card, lock));
      item.unlock.disabled = card.locking;
      return item.root;
    }),
  );
  card.offered = card.offered.filter((path) => !locks.some((lock) => lock.path === path));
  parts.offer.hidden = card.offered.length === 0;
  for (const button of [parts.lock, parts.offerYes, parts.offerNo]) button.disabled = card.locking;
}

/**
 * Runs one lock change from the card with its lock controls off, then reads the locks again.
 * @param {Card} card
 * @param {() => Promise<unknown>} work
 */
async function lockWork(card, work) {
  if (card.locking) return;
  card.locking = true;
  showLocks(card);
  try {
    await work();
  } finally {
    card.locking = false;
    // The card was held while the request was pending; it may swap now, even if the reload
    // below fails. An offer still unanswered keeps holding it.
    showPairs();
    await loadLocks();
  }
}

/** @param {Card} card */
function lockChosen(card) {
  return lockWork(card, async () => {
    const path = card.parts.lockPath.value;
    const answer = await postJson(locksPath(), { candidateId: card.candidate.id, path });
    ({ locks } = await getJson(locksPath()));
    const offer = macroOffer(answer.macros, locks);
    card.offered = offer?.paths ?? [];
    card.parts.offerText.textContent = offer?.text ?? "";
    const count = answer.removed.length;
    const replaced =
      count === 0 ? "" : ` It replaces ${count} earlier lock${count === 1 ? "" : "s"}.`;
    status.say(`Locked ${path} as ${card.label.toLowerCase()} has it.${replaced}`);
  });
}

/** @param {Card} card */
function lockOffered(card) {
  return lockWork(card, async () => {
    const paths = card.offered;
    for (const path of paths) {
      await postJson(locksPath(), { candidateId: card.candidate.id, path });
    }
    card.offered = [];
    status.say(`Locked ${paths.join(", ")} too, at the values ${card.label.toLowerCase()} has.`);
  });
}

/**
 * @param {Card} card
 * @param {{ id: number, path: string }} lock
 */
function unlock(card, lock) {
  return lockWork(card, async () => {
    await postJson(`${locksPath()}/${lock.id}/remove`, {});
    status.say(`Unlocked ${lock.path}. Later candidates may change it again.`);
  });
}

/**
 * Sends an explore or a nudge from a card and follows its job; the card's button stays off
 * until the job finishes. A 409 naming the same job attaches to it.
 * @type {StartJob}
 */
async function startSteer(control, path, body) {
  control.wait();
  try {
    const { job, refused } = await startJob(path, body);
    control.hold(job);
    status.say(
      refused
        ? `${refused} Showing that job's progress.`
        : "Started. The new candidates appear below as they are ready.",
    );
    status.run(async () => {
      try {
        await follow(job);
      } finally {
        control.release();
        showControls();
      }
    });
  } catch (error) {
    control.release();
    showControls();
    throw error;
  }
}

/**
 * Sets the card's excerpt, its readouts and its audio wiring from its candidate.
 * @param {Card} card
 */
function showExcerpt(card) {
  const { parts, candidate } = card;
  const { excerpt } = candidate;
  card.wiring.abort();
  card.wiring = new AbortController();
  parts.audio.pause();
  const findings = [...(candidate.lint?.findings ?? []), ...(excerpt?.checks.findings ?? [])];
  parts.lint.textContent =
    findings.length === 0 ? "Passes the brief's rules and the render checks." : "Findings:";
  parts.lint.classList.toggle("ok", findings.length === 0);
  showFindings(parts.findings, findings);
  card.tracker = excerpt && createPlayedTracker(excerpt.duration);
  parts.audio.hidden = !excerpt;
  parts.missing.hidden = Boolean(excerpt);
  parts.played.textContent = "";
  parts.features.textContent = excerpt ? featuresText(excerpt.features) : "";
  showRanges(card);
  if (excerpt && card.tracker) {
    parts.audio.src = excerpt.url;
    trackAudio(
      parts.audio,
      card.tracker,
      {
        onPlay: () => {
          for (const other of cards) if (other !== card) other.parts.audio.pause();
          choose(card);
        },
        onChange: () => showPlayed(card),
        // A pair waiting to swap does so once the card it would hide stops playing.
        onStop: showPairs,
        onError: status.fail,
      },
      card.wiring.signal,
    );
  } else {
    parts.audio.removeAttribute("src");
  }
}

/**
 * Sends one rating of the card, with its controls off until the server answers. On a failure
 * the controls go back to what the server last confirmed, and the status line says why.
 * @param {Card} card
 * @param {() => Promise<unknown>} work
 */
async function rateCard(card, work) {
  if (card.busy) return;
  choose(card);
  card.busy = true;
  showCardControls();
  try {
    await work();
    await loadCandidates();
    await loadRatings();
  } catch (error) {
    showRated(card);
    throw error;
  } finally {
    card.busy = false;
    showCardControls();
    showPairs();
  }
}

/** What every rating of the card sends: the render heard and how it was heard. */
function measured(/** @type {Card} */ card) {
  const { excerpt } = card.candidate;
  if (!excerpt || !card.tracker) {
    throw new Error(`${card.label} has no excerpt yet; wait for it to render.`);
  }
  return {
    renderId: excerpt.renderId,
    playedFraction: card.tracker.fraction(),
    timeTakenMs: selection.elapsedMs(),
  };
}

/** @param {number} feedbackId */
const removeFeedback = (feedbackId) => postJson(`${SESSION}/feedback/${feedbackId}/remove`, {});

/**
 * Thumbs as a toggle pair: pressing the live thumb again clears it; pressing the other replaces
 * it.
 * @param {Card} card
 * @param {string} direction one of THUMBS
 */
function thumbs(card, direction) {
  return rateCard(card, async () => {
    const live = choicesOf(card).thumbs;
    if (live?.direction === direction) {
      await removeFeedback(live.id);
      status.say(`Thumbs ${direction} cleared for ${card.label.toLowerCase()}.`);
      return;
    }
    card.parts.up.setAttribute("aria-pressed", String(direction === UP));
    card.parts.down.setAttribute("aria-pressed", String(direction === DOWN));
    const how = measured(card);
    choose(card);
    const note = card.parts.note.value.trim() === "" ? undefined : card.parts.note.value;
    await postJson(`${SESSION}/thumbs`, { ...how, direction, note });
    card.parts.note.value = "";
    selection.restart();
    status.say(
      `Thumbs ${direction}${note ? " with the note" : ""} saved for ${card.label.toLowerCase()}: ` +
        `played ${percent(how.playedFraction)}, ${(how.timeTakenMs / 1000).toFixed(1)} s.`,
    );
  });
}

/**
 * One choice per macro: Less, More, or cleared. A new choice replaces the old one; the same one
 * again sends nothing.
 * @param {Card} card
 * @param {string} macro
 * @param {string | null} direction one of MACRO_DIRECTIONS, or null to clear
 */
function macroChoice(card, macro, direction) {
  return rateCard(card, async () => {
    const live = choicesOf(card).macros[macro] ?? null;
    if ((live?.direction ?? null) === direction) return;
    const buttons = /** @type {MacroButtons} */ (card.macros[macro]);
    buttons.less.setAttribute("aria-pressed", String(direction === LESS));
    buttons.clear.setAttribute("aria-pressed", String(direction === null));
    buttons.more.setAttribute("aria-pressed", String(direction === MORE));
    if (direction === null) {
      await removeFeedback(/** @type {any} */ (live).id);
      status.say(`The ${macro} choice for ${card.label.toLowerCase()} is cleared.`);
      return;
    }
    const how = measured(card);
    await postJson(`${SESSION}/macro-feedback`, { ...how, macro, direction });
    selection.restart();
    status.say(`Saved for ${card.label.toLowerCase()}: ${direction} ${macro}.`);
  });
}

/**
 * The candidates a hide of the card names: its own, or both of its revised pair, which take one
 * place in the table (decision 0049).
 * @param {Card} card
 */
function hideIds({ candidate: { id, pair } }) {
  return pair === null ? [id] : [pair.firstTryId, pair.revisionId];
}

/**
 * Hides the card into the hidden panel, or shows it in the table again. Its ratings stay.
 * @param {Card} card
 */
async function toggleHidden(card) {
  if (card.busy) {
    throw new Error(`${card.label}'s last change is still being saved; try again when it is.`);
  }
  const hidden = !card.candidate.hidden;
  const ids = hideIds(card);
  card.busy = true;
  showCardControls();
  try {
    if (hidden) {
      for (const other of cards) if (ids.includes(other.candidate.id)) other.parts.audio.pause();
      if (marked && ids.includes(marked.candidate.id)) unmark();
    }
    await postJson(`${SESSION}/hidden`, { candidateIds: ids, hidden });
    await loadCandidates();
    status.say(
      hidden
        ? `${card.label} hidden. Hidden candidates, at the bottom of the page, lists it.`
        : `${card.label} is shown in the table again.`,
    );
  } finally {
    card.busy = false;
    showCardControls();
    showPairs();
  }
}

/** @param {Card} card */
function keepSketch(card) {
  return rateCard(card, async () => {
    const { renderId } = measured(card);
    const tags = card.parts.tags.value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
    await postJson(`${SESSION}/sketches`, {
      candidateId: card.candidate.id,
      renderId,
      notes: card.parts.note.value,
      tags,
    });
    card.parts.note.value = "";
    card.parts.tags.value = "";
    selection.restart();
    status.say(`${card.label} kept as a sketch. The brief page lists it.`);
  });
}

function unmark() {
  if (marked) {
    marked.parts.root.classList.remove("marked");
    marked.parts.compare.textContent = "Compare";
  }
  marked = null;
}

/** Where the page was scrolled, kept per tab while the owner is at Quick A/B or the A/B view. */
const scrollKept = () => scrollMemory(sessionStorage, `session ${sessionId} scroll`);

/** Scrolls back to where the page was when the owner left it, if it kept a place. */
function restoreScroll() {
  const y = scrollKept().take();
  if (y !== null) window.scrollTo(0, y);
}

const ab = abView({
  sessionId,
  status,
  onClose: () => {
    page.gridView.hidden = false;
    status.run(async () => restoreScroll());
    unmark();
    // A pair's listening isn't time spent on the selected card.
    selection.restart();
  },
  onRated: () => loadRatings(),
});

/** @param {Card} card */
const abCandidate = (card) =>
  /** @type {AbCandidate} */ ({
    label: card.label,
    excerpt: card.candidate.excerpt,
  });

/** @param {Card} card */
async function compare(card) {
  measured(card);
  if (marked === card) {
    unmark();
    status.say(`${card.label} is no longer marked to compare.`);
    return;
  }
  if (!marked) {
    marked = card;
    card.parts.root.classList.add("marked");
    card.parts.compare.textContent = "Marked; choose another";
    status.say(`${card.label} marked. Press Compare on another candidate.`);
    return;
  }
  const first = marked;
  if (!first.candidate.excerpt) throw new Error(`${first.label} has lost its excerpt; mark again.`);
  await openPair(card, first);
}

/**
 * Draws the pair's sides on the server and opens the A/B view on them.
 * @param {Card} a
 * @param {Card} b
 */
async function openPair(a, b) {
  const pair = await postJson(`${SESSION}/ab-pairs`, {
    a: measured(a).renderId,
    b: measured(b).renderId,
  });
  for (const other of cards) other.parts.audio.pause();
  scrollKept().save(window.scrollY);
  page.gridView.hidden = true;
  ab.open(pair, { a: abCandidate(a), b: abCandidate(b) });
  status.say("Play both sides, then choose which is better.");
}

/**
 * Opens the A/B view on the pair the taste model is least sure how to order, among the shown
 * candidates with an excerpt, leaving out pairs this session already compared (0046). It draws
 * as Quick A/B's best questions does.
 */
async function bestQuestion() {
  const pool = cards
    .filter(({ candidate }) => candidate.excerpt !== null && !candidate.hidden)
    .map(({ candidate }) => candidate);
  const question = questionOf(ranking, pool);
  if (!question) throw new Error("This session isn't ranked by your taste model.");
  const order = createQuickAbOrder(
    pool.map(({ id }) => id),
    {
      mode: BEST,
      random: Math.random,
      prior: ratedPairKeys(rated.ratings, sessionId, pool),
      question,
    },
  );
  const ids = order.pair();
  if (!ids) {
    status.say(
      "Every pair the taste model can tell apart has been compared in this session. Ask for more candidates, or fit the model again on the Model test page.",
    );
    return;
  }
  unmark();
  const [a, b] = ids.map((id) => cards.find((card) => card.candidate.id === id));
  if (!a || !b) throw new Error(`the pair ${ids.join("–")} names a candidate with no row`);
  await openPair(a, b);
}

/** What the pair link says on each side of a pair. */
const PAIR_LINK = Object.freeze({
  firstTry: {
    text: "Show the revision",
    title:
      "The model revised this candidate once, after its excerpt missed a range or a check. Shows the revision in this card's place; this one stays one click away.",
  },
  revision: {
    text: "Show the first try",
    title:
      "This is the model's revision of a candidate whose excerpt missed a range or a check. Shows the first try in its place; this one stays one click away.",
  },
});

/**
 * Shows one card of each revised pair, as `pairSwap` picks, with a link to the other. A card
 * isn't replaced while its excerpt plays, it holds the focus, or its note or tags are unsent,
 * so a note being typed keeps its text and the focus; the swap runs again when that ends.
 */
function showPairs() {
  const byId = new Map(cards.map((card) => [card.candidate.id, card]));
  /** @type {import("./pair-swap.js").Held} */
  const held = {
    playing: (id) => {
      const card = byId.get(id);
      return Boolean(card && !card.parts.audio.paused);
    },
    editing: (id) => {
      const card = byId.get(id);
      if (!card) return false;
      const { note, tags } = card.parts;
      return card.hold.held({
        unsentText: note.value.trim() !== "" || tags.value.trim() !== "" || card.steer.unsent(),
        pending: card.busy || card.locking || card.offered.length > 0,
      });
    },
  };
  for (const card of cards) {
    const { pair, id } = card.candidate;
    card.parts.pairLink.hidden = pair === null;
    if (pair === null) {
      card.parts.root.hidden = false;
      continue;
    }
    card.parts.root.hidden = pairSwap.show(pair.firstTryId, pair.shownId, held) !== id;
    const link = id === pair.revisionId ? PAIR_LINK.revision : PAIR_LINK.firstTry;
    card.parts.pairLink.textContent = link.text;
    card.parts.pairLink.title = link.title;
  }
}

/**
 * The owner chose the other card of the card's pair. The focus moves to that card's link, since
 * this one is hidden.
 * @param {Card} card
 */
function showOther(card) {
  const { pair, id } = card.candidate;
  if (pair === null) return;
  const other = id === pair.firstTryId ? pair.revisionId : pair.firstTryId;
  card.parts.audio.pause();
  pairSwap.choose(pair.firstTryId, other);
  showPairs();
  cards.find((shown) => shown.candidate.id === other)?.parts.pairLink.focus();
}

/**
 * @param {Candidate} candidate
 * @param {number} number
 * @param {boolean} revised whether it is the revision of first try `number`
 * @returns {Card}
 */
function makeCard(candidate, number, revised) {
  const parts = cloneTemplate("candidate-row", CARD_PARTS);
  mountPlayer(parts.audio, status.fail);
  /** @type {Record<string, MacroButtons>} */
  const macros = {};
  /** @type {Card} */
  const card = {
    candidate,
    label: `Candidate ${number}${revised ? ", revised" : ""}`,
    parts,
    macros,
    tracker: null,
    wiring: new AbortController(),
    hold: createCardHold(),
    busy: false,
    steer: steerControls({
      candidateId: candidate.id,
      sessionId: () => sessionId,
      start: startSteer,
      run: status.run,
    }),
    offered: [],
    locking: false,
  };
  parts.heading.textContent = card.label;
  parts.rowId.textContent = `#${candidate.id}`;
  parts.intent.textContent = intentText(candidate);
  parts.steer.append(card.steer.root);
  parts.lockPath.replaceChildren(
    ...lockChoices(candidate.genome).map(({ label, choices }) => {
      const group = document.createElement("optgroup");
      group.label = label;
      group.append(
        ...choices.map(({ path, label: words }) => {
          const option = document.createElement("option");
          option.value = path;
          option.textContent = words;
          return option;
        }),
      );
      return group;
    }),
  );
  parts.lock.onclick = () => status.run(() => lockChosen(card));
  parts.offerYes.onclick = () => status.run(() => lockOffered(card));
  parts.offerNo.onclick = () => {
    card.offered = [];
    showLocks(card);
    showPairs();
    status.say("The macros stay free, so the locked value still moves when they change.");
  };
  showLocks(card);
  for (const macro of MACRO_NAMES) {
    const choice = cloneTemplate("macro-choice", {
      name: HTMLElement,
      less: HTMLButtonElement,
      clear: HTMLButtonElement,
      more: HTMLButtonElement,
    });
    const titles = macroTitles(macro);
    choice.name.textContent = macro;
    choice.less.title = titles.less;
    choice.clear.title = titles.clear;
    choice.more.title = titles.more;
    choice.less.onclick = () => status.run(() => macroChoice(card, macro, LESS));
    choice.clear.onclick = () => status.run(() => macroChoice(card, macro, null));
    choice.more.onclick = () => status.run(() => macroChoice(card, macro, MORE));
    macros[macro] = choice;
    parts.macros.append(choice.root);
  }
  parts.up.onclick = () => status.run(() => thumbs(card, UP));
  parts.down.onclick = () => status.run(() => thumbs(card, DOWN));
  parts.sketch.onclick = () => status.run(() => keepSketch(card));
  const compareOnce = oneAtATime(() => compare(card));
  parts.compare.onclick = () => status.run(compareOnce);
  parts.hide.onclick = () => status.run(() => toggleHidden(card));
  parts.expand.onclick = () => {
    const open = parts.moreRow.hidden;
    parts.moreRow.hidden = !open;
    parts.expand.setAttribute("aria-expanded", String(open));
    parts.expand.textContent = open ? "Fewer controls" : "More controls";
  };
  parts.pairLink.onclick = () => showOther(card);
  // A swap held by the card runs again once it is free: a turn after the focus leaves, so the
  // focus has landed, and after a press ends (below), so the click lands first.
  parts.root.addEventListener("focusin", () => card.hold.focusIn());
  parts.root.addEventListener("focusout", () => {
    card.hold.focusOut();
    setTimeout(showPairs);
  });
  parts.root.addEventListener("pointerdown", () => card.hold.pointerDown());
  showExcerpt(card);
  return card;
}

/** Turns the job buttons on or off from the session's state and the jobs being followed. */
function showControls() {
  const stopped = session?.stoppedAt !== null;
  const running = [...jobs.values()].find((job) => job.finishedAt === null);
  if (stopped) {
    const why = "This session is stopped. Start a new session from the brief page.";
    offBecause(page.askButton, why);
    offBecause(page.stopButton, why);
    page.excerptsButton.hidden = true;
  } else if (!posting) {
    if (running) {
      ask.hold(running);
      excerpts.hold(running);
    } else {
      ask.release();
      excerpts.release();
    }
  }
  // Recovery only: a candidates job renders its own excerpts (decision 0031).
  page.excerptsButton.hidden =
    stopped || Boolean(running) || posting || !cards.some((card) => !card.candidate.excerpt);
  page.bestQuestionButton.hidden = ranking === null;
  offBecause(
    page.bestQuestionButton,
    stopped
      ? "This session is stopped, so it takes no more ratings. Start a new session from the brief page."
      : null,
  );
  showCardControls();
}

/**
 * Follows a job to its end, showing its progress and loading the candidates whenever its count
 * or step moves.
 * @param {JobStatus} job
 */
async function follow(job) {
  if (jobs.has(job.id)) return;
  // A finished job's box goes when a new one starts.
  for (const [id, box] of boxes) {
    if (jobs.get(id)?.finishedAt !== null) {
      box.root.remove();
      boxes.delete(id);
    }
  }
  const box = jobBox((shown) => status.run(() => cancel(shown)));
  boxes.set(job.id, box);
  page.jobBox.append(box.root);
  let seen = `${job.progress?.done}/${job.progress?.step}`;
  try {
    const finished = await followJob(job, async (current) => {
      jobs.set(current.id, current);
      box.show(current);
      showControls();
      const now = `${current.progress?.done}/${current.progress?.step}`;
      if (now !== seen) {
        seen = now;
        await loadCandidates();
      }
    });
    await loadCandidates();
    showControls();
    status.say(
      finished.state === JOB_STATE.done
        ? "The job is done. Play the candidates and rate them."
        : endedText(finished),
    );
  } finally {
    // A failed poll leaves the job unfinished in `jobs`, which would keep the buttons off until
    // a reload. The caller shows the error; a reload follows the job again if it still runs.
    if (jobs.get(job.id)?.finishedAt === null) jobs.delete(job.id);
    showControls();
  }
}

/** @param {JobStatus} job */
async function cancel(job) {
  const after = await postJson(`${jobPath(job.id)}/cancel`, {});
  boxes.get(job.id)?.show(after);
}

/**
 * Starts a job from a button, which stays off from the click until the job finishes. A 409
 * naming the same job attaches to it.
 * @param {import("./job-control.js").JobControl} control
 * @param {string} path
 * @param {Record<string, unknown>} body
 */
async function start(control, path, body) {
  posting = true;
  control.wait();
  try {
    const { job, refused } = await startJob(path, body);
    status.say(refused ? `${refused} Showing that job's progress.` : "Started.");
    posting = false;
    status.run(() => follow(job));
  } finally {
    posting = false;
    showControls();
  }
}

const askCandidates = oneAtATime(() => {
  const text = page.countInput.value.trim();
  return start(ask, `${SESSION}/candidates`, text === "" ? {} : { count: Number(text) });
});

const renderExcerpts = oneAtATime(() => start(excerpts, `${SESSION}/excerpts`, {}));

function showSession() {
  const open = session.stoppedAt === null;
  page.pageTitle.textContent = `Session ${sessionId}${open ? "" : " (stopped)"}`;
}

const stopSession = oneAtATime(async () => {
  if (!confirm(`Stop session ${sessionId}? Its jobs are cancelled and it takes no more ratings.`)) {
    return;
  }
  session = await postJson(`${SESSION}/stop`, {});
  showSession();
  showControls();
  status.say(`Session ${sessionId} stopped. Start a new one from the brief page.`);
});

/**
 * Puts each row in its table in the order given, moving only the rows out of place, so a row
 * that stays where it was is never taken out of the page.
 * @param {HTMLTableElement} table
 * @param {readonly HTMLElement[]} rows
 */
function placeRows(table, rows) {
  rows.forEach((row, i) => {
    const at = table.tBodies[i];
    if (at !== row) table.insertBefore(row, at ?? null);
  });
}

/**
 * Lays the cards out: each under the one it was made from, indented by its depth, and the
 * hidden ones in the hidden panel (decision 0049).
 */
function layoutRows() {
  const byId = new Map(cards.map((card) => [card.candidate.id, card]));
  /** @param {number} id */
  const cardOf = (id) => {
    const card = byId.get(id);
    if (!card) throw new Error(`the table names candidate ${id}, which has no row`);
    return card;
  };
  const { shown, hidden } = candidateRows(cards.map((card) => card.candidate));
  /**
   * @param {number} id
   * @param {number} depth
   */
  const indent = (id, depth) => {
    const { parts } = cardOf(id);
    parts.branch.textContent = depth > 0 ? "↳" : "";
    parts.nameCell.style.setProperty("--depth", String(depth));
    return parts.root;
  };
  placeRows(
    page.candidateTable,
    shown.map(({ id, depth }) => indent(id, depth)),
  );
  placeRows(
    page.hiddenTable,
    hidden.map((id) => indent(id, 0)),
  );
  page.candidateTable.hidden = shown.length === 0;
  page.noCandidates.hidden = shown.length > 0;
  page.noCandidates.textContent =
    cards.length === 0
      ? NO_CANDIDATES
      : "Every candidate is hidden. Open Hidden candidates below to see them again.";
  // A revised pair is one row in the panel, as in the table.
  const places = hidden.filter((id) => cardOf(id).candidate.pair?.revisionId !== id).length;
  page.hiddenBox.hidden = places === 0;
  page.hiddenSummary.textContent = `Hidden candidates (${places})`;
}

async function loadRatings() {
  rated = await getJson(`${VIBES_PATH}/${session.vibeId}/ratings`);
  for (const card of cards) showRated(card);
}

/** Loads the candidates, updating each card in place. */
async function loadCandidates() {
  /** @type {{ candidates: Candidate[], ranking: import("./best-question.js").PairRanking | null }} */
  const listed = await getJson(`${SESSION}/candidates`);
  const { candidates } = listed;
  ranking = listed.ranking;
  // A brief saved while the session runs makes a version the page hasn't read yet.
  if (candidates.some((candidate) => !rangesByRevision.has(candidate.vibeRevisionId))) {
    await loadRanges();
  }
  const withGenome = candidates.filter(
    (candidate) => /** @type {any} */ (candidate).genome !== null,
  );
  const rejected = candidates.filter((candidate) => /** @type {any} */ (candidate).genome === null);
  const before = new Map(cards.map((card) => [card.candidate.id, card]));
  /** @type {Map<number, number>} each card's number, by candidate id */
  const numbers = new Map();
  let firstTries = 0;
  cards = withGenome.map((candidate) => {
    const { pair } = candidate;
    const parent = pair?.revisionId === candidate.id ? numbers.get(pair.firstTryId) : undefined;
    const number = parent ?? ++firstTries;
    numbers.set(candidate.id, number);
    const kept = before.get(candidate.id);
    if (!kept) return makeCard(candidate, number, parent !== undefined);
    const changed = kept.candidate.excerpt?.renderId !== candidate.excerpt?.renderId;
    kept.candidate = candidate;
    if (changed) showExcerpt(kept);
    return kept;
  });
  layoutRows();
  for (const card of cards) {
    // Every card is made before any is named, so a parent made in this load has its label.
    card.parts.origin.textContent = originText(card.candidate, nameOf);
    showRated(card);
    showLocks(card);
  }
  showPairs();
  showControls();

  page.rejectedBox.hidden = rejected.length === 0;
  const draws = rejected.filter((candidate) => candidate.operator === OPERATOR.nudge).length;
  const answers = rejected.length - draws;
  page.rejectedSummary.textContent = `${rejected.length} rejected candidate${rejected.length === 1 ? "" : "s"}: ${[
    answers > 0 &&
      `${answers} model answer${answers === 1 ? "" : "s"} that broke the format or the brief's rules even after one fix`,
    draws > 0 &&
      `${draws} nudge draw${draws === 1 ? "" : "s"} that broke the rules or repeated a genome, each drawn again`,
  ]
    .filter(Boolean)
    .join(", and ")}`;
  page.rejectedList.replaceChildren(
    ...rejected.map((candidate) => {
      const item = cloneTemplate("rejected-item", {
        line: HTMLElement,
        findings: HTMLUListElement,
      });
      const meant = candidate.intent ? `, meant as “${candidate.intent}”` : "";
      const from =
        candidate.parentIds.length > 0
          ? ` from ${nameOf(/** @type {number} */ (candidate.parentIds[0]))}`
          : "";
      item.line.textContent = `Candidate #${candidate.id}: ${rejectText(candidate)}${from}${meant}`;
      showFindings(item.findings, candidate.lint?.findings ?? []);
      return item.root;
    }),
  );
}

page.askButton.onclick = () => status.run(askCandidates);
page.excerptsButton.onclick = () => status.run(renderExcerpts);
page.stopButton.onclick = () => status.run(stopSession);
const askBest = oneAtATime(bestQuestion);
page.bestQuestionButton.onclick = () => status.run(askBest);
// A press ends wherever the pointer is released, so the page listens, not the card. The click
// that follows a pointerup is dispatched before the deferred swap runs.
// The page restores its own scroll once the rows are loaded; the browser's would land before them.
history.scrollRestoration = "manual";
keepOnClick(page.quickAbLink, scrollKept(), () => window.scrollY);
window.addEventListener("pageshow", (event) => {
  // A page brought back from the back-forward cache is where it was; drop the place kept.
  if (event.persisted) status.run(async () => scrollKept().take());
});
for (const type of ["pointerup", "pointercancel"]) {
  document.addEventListener(type, () => {
    for (const card of cards) card.hold.pointerUp();
    setTimeout(showPairs);
  });
}

status.run(async () => {
  session = await getJson(SESSION);
  showSession();
  const vibe = await getJson(`${VIBES_PATH}/${session.vibeId}`);
  page.briefLink.href = `./brief.html?id=${session.vibeId}`;
  page.briefLink.textContent = vibe.revision.name;
  page.lineageLink.href = `./lineage.html?id=${session.vibeId}&session=${sessionId}`;
  page.quickAbLink.href = `./quick-ab.html?id=${sessionId}`;
  document.title = `Session ${sessionId}, ${vibe.revision.name} · Ambient Studio`;
  await loadRanges();
  await loadRatings();
  await loadCandidates();
  await loadLocks();
  restoreScroll();
  const unfinished = session.jobs.filter((/** @type {any} */ job) => job.finishedAt === null);
  status.say(
    unfinished.length > 0
      ? "A job is running; candidates appear below as they are ready."
      : cards.length === 0
        ? "Press Ask for new candidates to begin."
        : "Play a candidate, then rate it with the buttons on its row.",
  );
  for (const job of unfinished) status.run(() => follow(job));
  showControls();
});

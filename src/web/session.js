// The session page (decisions 0028 and 0032): the candidate grid, one card per candidate with its
// excerpt, its rating controls and its details; the A/B view; and the session's jobs, each with
// its progress, followed until they finish. Of a revised pair, one card shows and links the
// other (0036). Played fraction and time taken are measured here as decision 0027 defines them.
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { AbCandidate } from "./ab-view.js" */
/** @import { JobStatus } from "./job-progress.js" */
/** @import { PlayedTracker } from "./played-tracker.js" */
import { featuresText } from "../domain/features-text.js";
import { MACRO_DIRECTIONS, THUMBS } from "../domain/rating-values.js";
import { MACROS } from "../engine/genome-schema.js";
import { abView } from "./ab-view.js";
import { getJson, jobPath, postJson, sessionPath, startJob, VIBES_PATH } from "./api.js";
import { trackAudio } from "./audio-player.js";
import { createSelection } from "./candidate-selection.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { followJob } from "./follow-job.js";
import { jobControl } from "./job-control.js";
import { JOB_STATE } from "./job-progress.js";
import { jobBox, TONE } from "./job-view.js";
import { macroTitles } from "./macro-words.js";
import { oneAtATime } from "./one-at-a-time.js";
import { createPairSwap } from "./pair-swap.js";
import { createPlayedTracker } from "./played-tracker.js";
import { statusLine } from "./status-line.js";

const [UP, DOWN] = THUMBS;
const [MORE, LESS] = MACRO_DIRECTIONS;
const MACRO_NAMES = Object.keys(MACROS);

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  countInput: HTMLInputElement,
  askButton: HTMLButtonElement,
  excerptsButton: HTMLButtonElement,
  stopButton: HTMLButtonElement,
  jobBox: HTMLElement,
  gridView: HTMLElement,
  candidateGrid: HTMLElement,
  noCandidates: HTMLElement,
  rejectedBox: HTMLElement,
  rejectedSummary: HTMLElement,
  rejectedList: HTMLUListElement,
});
const idText = new URLSearchParams(location.search).get("id");
if (idText === null) throw new Error("session.html needs ?id=<session id>");
const sessionId = Number(idText);
const SESSION = sessionPath(sessionId);

/** The parts of a candidate card in session.html. */
const CARD_PARTS = Object.freeze({
  heading: HTMLElement,
  thumbsBadge: HTMLElement,
  sketchBadge: HTMLElement,
  intent: HTMLElement,
  audio: HTMLAudioElement,
  missing: HTMLElement,
  played: HTMLElement,
  up: HTMLButtonElement,
  down: HTMLButtonElement,
  compare: HTMLButtonElement,
  macros: HTMLElement,
  note: HTMLTextAreaElement,
  tags: HTMLInputElement,
  sketch: HTMLButtonElement,
  features: HTMLElement,
  lint: HTMLElement,
  findings: HTMLUListElement,
  pairLink: HTMLButtonElement,
});

/** @typedef {{ less: HTMLButtonElement, clear: HTMLButtonElement, more: HTMLButtonElement }} MacroButtons */

/**
 * A candidate as `GET …/candidates` returns it, with a genome.
 * @typedef {object} Candidate
 * @property {number} id
 * @property {number} genomeId
 * @property {number} seed
 * @property {string | null} intent
 * @property {LintResult | null} lint
 * @property {{ renderId: number, url: string, duration: number, features: any, checks: LintResult } | null} excerpt
 * @property {{ thumbs: { id: number, direction: string, note: string | null } | null, macros: Record<string, { id: number, direction: string }> }} feedback
 *   the live choices, one per thumbs and per macro (decision 0031)
 * @property {{ firstTryId: number, revisionId: number, shownId: number } | null} pair a first
 *   try and its revision, and which the server would show (decision 0036)
 */

/**
 * A card in the grid. It is updated in place when its excerpt lands, so a note being typed in
 * it keeps its text and the focus.
 * @typedef {object} Card
 * @property {Candidate} candidate
 * @property {number} number its place among the session's first tries, from 1; a revision
 *   has its first try's
 * @property {ReturnType<typeof cloneTemplate<typeof CARD_PARTS>>} parts
 * @property {Record<string, MacroButtons>} macros
 * @property {PlayedTracker | null} tracker null without an excerpt
 * @property {AbortController} wiring unwires the audio element from the tracker
 * @property {boolean} busy whether a rating of it is being sent
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
  const compared = rated.ratings.filter(
    (row) =>
      row.sessionId === sessionId &&
      [row.a, row.b].some(
        (side) => side.genomeId === card.candidate.genomeId && side.seed === card.candidate.seed,
      ),
  ).length;
  card.parts.played.textContent =
    `Played ${percent(card.tracker.fraction())}.` +
    (compared === 0 ? "" : ` Compared ${compared === 1 ? "once" : `${compared} times`}.`);
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
  showPlayed(card);
}

/** @param {Card} card */
const ratingButtons = (card) => [
  card.parts.up,
  card.parts.down,
  card.parts.sketch,
  card.parts.compare,
  ...Object.values(card.macros).flatMap(({ less, clear, more }) => [less, clear, more]),
];

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
  }
}

/** What every rating of the card sends: the render heard and how it was heard. */
function measured(/** @type {Card} */ card) {
  const { excerpt } = card.candidate;
  if (!excerpt || !card.tracker) {
    throw new Error(`Candidate ${card.number} has no excerpt yet; wait for it to render.`);
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
      status.say(`Thumbs ${direction} cleared for candidate ${card.number}.`);
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
      `Thumbs ${direction}${note ? " with the note" : ""} saved for candidate ${card.number}: ` +
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
      status.say(`The ${macro} choice for candidate ${card.number} is cleared.`);
      return;
    }
    const how = measured(card);
    await postJson(`${SESSION}/macro-feedback`, { ...how, macro, direction });
    selection.restart();
    status.say(`Saved for candidate ${card.number}: ${direction} ${macro}.`);
  });
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
    status.say(`Candidate ${card.number} kept as a sketch. The brief page lists it.`);
  });
}

function unmark() {
  if (marked) {
    marked.parts.root.classList.remove("marked");
    marked.parts.compare.textContent = "Compare";
  }
  marked = null;
}

const ab = abView({
  sessionId,
  status,
  onClose: () => {
    page.gridView.hidden = false;
    unmark();
    // A pair's listening isn't time spent on the selected card.
    selection.restart();
  },
  onRated: () => loadRatings(),
});

/** @param {Card} card */
const abCandidate = (card) =>
  /** @type {AbCandidate} */ ({
    label: `Candidate ${card.number}`,
    excerpt: card.candidate.excerpt,
  });

/** @param {Card} card */
async function compare(card) {
  measured(card);
  if (marked === card) {
    unmark();
    status.say(`Candidate ${card.number} is no longer marked to compare.`);
    return;
  }
  if (!marked) {
    marked = card;
    card.parts.root.classList.add("marked");
    card.parts.compare.textContent = "Marked; choose another";
    status.say(`Candidate ${card.number} marked. Press Compare on another candidate.`);
    return;
  }
  const first = marked;
  const firstExcerpt = first.candidate.excerpt;
  if (!firstExcerpt) throw new Error(`Candidate ${first.number} has lost its excerpt; mark again.`);
  const pair = await postJson(`${SESSION}/ab-pairs`, {
    a: measured(card).renderId,
    b: firstExcerpt.renderId,
  });
  for (const other of cards) other.parts.audio.pause();
  page.gridView.hidden = true;
  ab.open(pair, { a: abCandidate(card), b: abCandidate(first) });
  status.say("Play both sides, then choose which is better.");
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
 * whose excerpt plays isn't replaced until it stops.
 */
function showPairs() {
  const byId = new Map(cards.map((card) => [card.candidate.id, card]));
  /** @param {number} id */
  const playing = (id) => {
    const card = byId.get(id);
    return Boolean(card && !card.parts.audio.paused);
  };
  for (const card of cards) {
    const { pair, id } = card.candidate;
    card.parts.pairLink.hidden = pair === null;
    if (pair === null) {
      card.parts.root.hidden = false;
      continue;
    }
    card.parts.root.hidden = pairSwap.show(pair.firstTryId, pair.shownId, playing) !== id;
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
  const parts = cloneTemplate("candidate-card", CARD_PARTS);
  /** @type {Record<string, MacroButtons>} */
  const macros = {};
  /** @type {Card} */
  const card = {
    candidate,
    number,
    parts,
    macros,
    tracker: null,
    wiring: new AbortController(),
    busy: false,
  };
  parts.heading.textContent = `Candidate ${number}${revised ? ", revised" : ""}`;
  parts.intent.textContent = candidate.intent ?? "The model gave no intent.";
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
  parts.pairLink.onclick = () => showOther(card);
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
        : `The job ${finished.state === JOB_STATE.failed ? "stopped on an error; its box says why" : "was cancelled"}.`,
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

async function loadRatings() {
  rated = await getJson(`${VIBES_PATH}/${session.vibeId}/ratings`);
  for (const card of cards) showRated(card);
}

/** Loads the candidates, updating each card in place. */
async function loadCandidates() {
  /** @type {{ candidates: Candidate[] }} */
  const { candidates } = await getJson(`${SESSION}/candidates`);
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
  for (const card of cards) {
    if (!card.parts.root.isConnected) page.candidateGrid.append(card.parts.root);
    showRated(card);
  }
  showPairs();
  page.noCandidates.hidden = cards.length > 0;
  showControls();

  page.rejectedBox.hidden = rejected.length === 0;
  page.rejectedSummary.textContent = `${rejected.length} rejected candidate${rejected.length === 1 ? "" : "s"}: the answer broke the format or the brief's rules even after one fix`;
  page.rejectedList.replaceChildren(
    ...rejected.map((candidate) => {
      const item = cloneTemplate("rejected-item", {
        line: HTMLElement,
        findings: HTMLUListElement,
      });
      const meant = candidate.intent ? `, meant as “${candidate.intent}”` : "";
      item.line.textContent = `Candidate ${candidate.id}: ${/** @type {any} */ (candidate).rejectReason}${meant}`;
      showFindings(item.findings, candidate.lint?.findings ?? []);
      return item.root;
    }),
  );
}

page.askButton.onclick = () => status.run(askCandidates);
page.excerptsButton.onclick = () => status.run(renderExcerpts);
page.stopButton.onclick = () => status.run(stopSession);

status.run(async () => {
  session = await getJson(SESSION);
  showSession();
  const vibe = await getJson(`${VIBES_PATH}/${session.vibeId}`);
  page.briefLink.href = `./brief.html?id=${session.vibeId}`;
  page.briefLink.textContent = vibe.revision.name;
  document.title = `Session ${sessionId}, ${vibe.revision.name} · Ambient Studio`;
  await loadRatings();
  await loadCandidates();
  const unfinished = session.jobs.filter((/** @type {any} */ job) => job.finishedAt === null);
  status.say(
    unfinished.length > 0
      ? "A job is running; candidates appear below as they are ready."
      : cards.length === 0
        ? "Press Ask for new candidates to begin."
        : "Play a candidate, then rate it with the buttons on its card.",
  );
  for (const job of unfinished) status.run(() => follow(job));
  showControls();
});

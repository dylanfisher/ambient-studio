// The session view (decision 0028): the candidate grid, one `<audio>` per excerpt with its
// features, lint result and intent; thumbs with a note, more or less like this on a macro, keep
// as sketch and A/B pairs; and the session's jobs, polled until they finish. Played fraction
// and time taken are measured here as decision 0027 defines them.
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { AbCandidate } from "./ab-view.js" */
/** @import { PlayedTracker } from "./played-tracker.js" */
import { featuresText } from "../domain/features-text.js";
import { MACRO_DIRECTIONS, THUMBS } from "../domain/rating-values.js";
import { MACROS } from "../engine/genome-schema.js";
import { abView } from "./ab-view.js";
import { getJson, jobPath, postJson, sessionPath, VIBES_PATH } from "./api.js";
import { seekBy, togglePlay, trackAudio } from "./audio-player.js";
import { bindKeys, isFormControl } from "./bind-keys.js";
import { createSelection } from "./candidate-selection.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { oneAtATime } from "./one-at-a-time.js";
import { createPlayedTracker } from "./played-tracker.js";
import { statusLine } from "./status-line.js";

/** How often a running job's status is read: often enough that excerpts appear as they render. */
const POLL_MS = 1000;

const [UP, DOWN] = THUMBS;
const [MORE, LESS] = MACRO_DIRECTIONS;
const MACRO_NAMES = Object.keys(MACROS);

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  vibeLink: HTMLAnchorElement,
  countInput: HTMLInputElement,
  jobLine: HTMLElement,
  gridView: HTMLElement,
  candidateGrid: HTMLElement,
  noCandidates: HTMLElement,
  ratingHeading: HTMLElement,
  selectedReadout: HTMLElement,
  noteText: HTMLTextAreaElement,
  tagsInput: HTMLInputElement,
  macroSelect: HTMLSelectElement,
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
  intent: HTMLElement,
  audio: HTMLAudioElement,
  missing: HTMLElement,
  played: HTMLElement,
  features: HTMLElement,
  lint: HTMLElement,
  findings: HTMLUListElement,
  rated: HTMLElement,
});

/**
 * A candidate as `GET …/candidates` returns it, with a genome.
 * @typedef {object} Candidate
 * @property {number} id
 * @property {number} genomeId
 * @property {number} seed
 * @property {string | null} intent
 * @property {LintResult | null} lint
 * @property {{ renderId: number, url: string, duration: number, features: any, checks: LintResult } | null} excerpt
 */

/**
 * A card in the grid, kept while its excerpt stays the same so a reload doesn't cut playback.
 * @typedef {object} Card
 * @property {Candidate} candidate
 * @property {number} number its place among the session's candidates, from 1
 * @property {ReturnType<typeof cloneTemplate<typeof CARD_PARTS>>} parts
 * @property {PlayedTracker | null} tracker null without an excerpt
 */

/** @type {any} */
let session;
/** @type {Card[]} in the order the session made them */
let cards = [];
/** @type {import("./candidate-selection.js").Selection<Card>} */
const selection = createSelection(() => performance.now());
/** @type {Card | null} the first of an A/B pair, once marked */
let marked = null;
/** @type {{ ratings: any[], feedback: any[], sketches: any[] }} */
let rated = { ratings: [], feedback: [], sketches: [] };
/** @type {Set<number>} the jobs being polled */
const polling = new Set();

/** @param {number} fraction */
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

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

function showSelected() {
  const selected = selection.current();
  if (!selected) {
    page.ratingHeading.textContent = "No candidate selected";
    page.selectedReadout.textContent = "Press j to select one.";
    return;
  }
  page.ratingHeading.textContent = `Rating candidate ${selected.number}`;
  const played = selected.tracker ? `played ${percent(selected.tracker.fraction())}` : "no excerpt";
  const seconds = (selection.elapsedMs() / 1000).toFixed(0);
  page.selectedReadout.textContent = `${played}, ${seconds} s since you selected or last rated it.`;
}

/** @param {Card} card */
function showPlayed(card) {
  if (!card.tracker) return;
  card.parts.played.textContent = `Played ${percent(card.tracker.fraction())}.`;
  if (card === selection.current()) showSelected();
}

/** @param {Card} card */
function showRated(card) {
  const { genomeId, seed, id } = card.candidate;
  const mine = (/** @type {any} */ row) => row.sessionId === sessionId;
  const same = (/** @type {any} */ side) => side.genomeId === genomeId && side.seed === seed;
  const lines = [
    ...rated.feedback
      .filter((row) => mine(row) && same(row))
      .map((row) =>
        row.macro === null ? `thumbs ${row.direction}` : `${row.direction} ${row.macro}`,
      ),
    ...rated.ratings
      .filter((row) => mine(row) && (same(row.a) || same(row.b)))
      .map((row) => `A/B as side ${same(row.a) ? "a" : "b"}, outcome ${row.outcome}`),
    ...rated.sketches.filter((row) => row.candidateId === id).map(() => "kept as sketch"),
  ];
  card.parts.rated.textContent = lines.length === 0 ? "" : `Rated: ${lines.join("; ")}.`;
}

/**
 * The owner chose the card: by key, by click, or by starting its audio. Focus moves to it only
 * when nothing is being typed (candidate-selection.js).
 * @param {Card} card
 */
function choose(card) {
  const before = selection.current();
  const { focus } = selection.choose(card, { inField: isFormControl(document.activeElement) });
  if (before === card) return;
  before?.parts.audio.pause();
  before?.parts.root.classList.remove("selected");
  card.parts.root.classList.add("selected");
  if (focus) {
    card.parts.root.focus({ preventScroll: true });
    card.parts.root.scrollIntoView({ block: "nearest" });
  }
  showSelected();
}

/**
 * @param {Candidate} candidate
 * @param {number} number
 * @returns {Card}
 */
function makeCard(candidate, number) {
  const parts = cloneTemplate("candidate-card", CARD_PARTS);
  const { excerpt } = candidate;
  /** @type {Card} */
  const card = {
    candidate,
    number,
    parts,
    tracker: excerpt && createPlayedTracker(excerpt.duration),
  };
  parts.heading.textContent = `Candidate ${number}`;
  parts.intent.textContent = candidate.intent ?? "No intent given.";
  const findings = [...(candidate.lint?.findings ?? []), ...(excerpt?.checks.findings ?? [])];
  parts.lint.textContent =
    findings.length === 0 ? "Lint and render checks pass." : "Lint and render check findings:";
  parts.lint.classList.toggle("ok", findings.length === 0);
  showFindings(parts.findings, findings);
  if (excerpt && card.tracker) {
    parts.audio.src = excerpt.url;
    parts.features.textContent = featuresText(excerpt.features);
    trackAudio(
      parts.audio,
      card.tracker,
      {
        onPlay: () => {
          for (const other of cards) if (other !== card) other.parts.audio.pause();
          choose(card);
        },
        onChange: () => showPlayed(card),
        onError: status.fail,
      },
      new AbortController().signal,
    );
    showPlayed(card);
  } else {
    parts.audio.hidden = true;
    parts.missing.hidden = false;
  }
  parts.root.onclick = () => choose(card);
  return card;
}

/** @param {1 | -1} step */
function move(step) {
  if (cards.length === 0) throw new Error("No candidates yet; press g to ask for some.");
  const selected = selection.current();
  const at = selected ? cards.indexOf(selected) : -1;
  const next =
    at === -1 ? (step > 0 ? 0 : cards.length - 1) : (at + step + cards.length) % cards.length;
  const card = cards[next];
  if (card) choose(card);
}

/** The selected card with its excerpt, or an error saying what's missing. */
function heard() {
  const selected = selection.current();
  if (!selected) throw new Error("Select a candidate first, with j or k.");
  const { excerpt } = selected.candidate;
  if (!excerpt || !selected.tracker) {
    throw new Error(`Candidate ${selected.number} has no current excerpt; press e to render it.`);
  }
  return { card: selected, excerpt, tracker: selected.tracker };
}

/** What every rating of the selected candidate sends: the render heard and how it was heard. */
function measured() {
  const { card, excerpt, tracker } = heard();
  return {
    card,
    renderId: excerpt.renderId,
    playedFraction: tracker.fraction(),
    timeTakenMs: selection.elapsedMs(),
  };
}

/**
 * @param {number} number
 * @param {string} what
 * @param {{ playedFraction: number, timeTakenMs: number }} how
 */
function stored(number, what, { playedFraction, timeTakenMs }) {
  // The next rating of this card measures from this one (decision 0028).
  selection.restart();
  status.say(
    `${what} stored for candidate ${number}: played ${percent(playedFraction)}, ` +
      `${(timeTakenMs / 1000).toFixed(1)} s.`,
  );
}

/** @param {string} direction one of THUMBS */
async function thumbs(direction) {
  const { card, ...how } = measured();
  const note = page.noteText.value.trim() === "" ? undefined : page.noteText.value;
  await postJson(`${SESSION}/thumbs`, { ...how, direction, note });
  page.noteText.value = "";
  await loadRatings();
  stored(card.number, `Thumbs ${direction}${note ? " with the note" : ""}`, how);
}

/** @param {string} direction one of MACRO_DIRECTIONS */
async function macroFeedback(direction) {
  const { card, ...how } = measured();
  const macro = page.macroSelect.value;
  await postJson(`${SESSION}/macro-feedback`, { ...how, macro, direction });
  await loadRatings();
  stored(card.number, `${direction} ${macro}`, how);
}

async function keepSketch() {
  const { card, excerpt } = heard();
  const tags = page.tagsInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  await postJson(`${SESSION}/sketches`, {
    candidateId: card.candidate.id,
    renderId: excerpt.renderId,
    notes: page.noteText.value,
    tags,
  });
  page.noteText.value = "";
  page.tagsInput.value = "";
  await loadRatings();
  selection.restart();
  status.say(`Candidate ${card.number} kept as a sketch.`);
}

function unmark() {
  marked?.parts.root.classList.remove("marked");
  marked = null;
}

const ab = abView({
  sessionId,
  status,
  onClose: () => {
    showView("session");
    page.gridView.hidden = false;
    unmark();
    // A pair's listening isn't time spent on the selected card.
    selection.restart();
    selection.current()?.parts.root.focus();
  },
  onRated: () => loadRatings(),
});

/** @param {Card} card */
const abCandidate = (card) =>
  /** @type {AbCandidate} */ ({
    label: `Candidate ${card.number}`,
    excerpt: card.candidate.excerpt,
  });

async function markAb() {
  const { card, excerpt } = heard();
  if (marked === card) {
    unmark();
    status.say(`Candidate ${card.number} unmarked.`);
    return;
  }
  if (!marked) {
    marked = card;
    card.parts.root.classList.add("marked");
    status.say(`Candidate ${card.number} marked. Select another and press x to compare them.`);
    return;
  }
  const first = marked;
  const firstExcerpt = first.candidate.excerpt;
  if (!firstExcerpt) throw new Error(`Candidate ${first.number} has lost its excerpt; mark again.`);
  const pair = await postJson(`${SESSION}/ab-pairs`, {
    a: excerpt.renderId,
    b: firstExcerpt.renderId,
  });
  for (const other of cards) other.parts.audio.pause();
  showView("ab");
  page.gridView.hidden = true;
  ab.open(pair, { a: abCandidate(card), b: abCandidate(first) });
  status.say("Which is better? Play each side with 1 and 2.");
}

/** @param {any} job a job's status */
function showJob(job) {
  const progress = job.progress ? `, excerpt ${job.progress.done} of ${job.progress.total}` : "";
  const error = job.error ? `: ${job.error}` : "";
  page.jobLine.textContent = `Job ${job.id} (${job.kind}): ${job.state}${progress}${error}`;
}

/**
 * Reads the job's status every `POLL_MS` until it finishes, loading the candidates whenever
 * another excerpt is done. Each read waits for the last, so slow replies never pile up.
 * @param {any} job its status as last read
 */
async function poll(job) {
  if (polling.has(job.id)) return;
  polling.add(job.id);
  let current = job;
  let done = job.progress?.done ?? 0;
  try {
    showJob(current);
    while (current.finishedAt === null) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      current = await getJson(jobPath(current.id));
      showJob(current);
      if ((current.progress?.done ?? 0) !== done) {
        done = current.progress?.done ?? 0;
        await loadCandidates();
      }
    }
  } finally {
    polling.delete(job.id);
  }
  await loadCandidates();
  status.say(`Job ${current.id} ${current.state}.`);
}

// Only the POST is guarded, so a second press can't add a second job; polling runs on its own.
const askCandidates = oneAtATime(async () => {
  const text = page.countInput.value.trim();
  const job = await postJson(`${SESSION}/candidates`, text === "" ? {} : { count: Number(text) });
  status.say(`Asked for candidates: job ${job.id}.`);
  status.run(() => poll(job));
});

const renderExcerpts = oneAtATime(async () => {
  const job = await postJson(`${SESSION}/excerpts`, {});
  status.say(`Rendering excerpts: job ${job.id}.`);
  status.run(() => poll(job));
});

async function cancelJob() {
  session = await getJson(SESSION);
  const job = session.jobs.filter((/** @type {any} */ row) => row.finishedAt === null).at(-1);
  if (!job) throw new Error("No job of this session is running.");
  showJob(await postJson(`${jobPath(job.id)}/cancel`, {}));
}

function showSession() {
  const state = session.stoppedAt === null ? "open" : "stopped";
  page.pageTitle.textContent = `Session ${sessionId} (${state})`;
}

async function stopSession() {
  if (!confirm(`Stop session ${sessionId}? Its jobs are cancelled and it takes no more ratings.`)) {
    return;
  }
  session = await postJson(`${SESSION}/stop`, {});
  showSession();
  status.say(`Session ${sessionId} stopped. Start a new one from the vibe page.`);
}

async function loadRatings() {
  rated = await getJson(`${VIBES_PATH}/${session.vibeId}/ratings`);
  for (const card of cards) showRated(card);
}

/** Loads the candidates, keeping each card whose excerpt hasn't changed. */
async function loadCandidates() {
  /** @type {{ candidates: any[] }} */
  const { candidates } = await getJson(`${SESSION}/candidates`);
  const withGenome = candidates.filter((candidate) => candidate.genome !== null);
  const rejected = candidates.filter((candidate) => candidate.genome === null);
  const before = new Map(cards.map((card) => [card.candidate.id, card]));
  cards = withGenome.map((candidate, i) => {
    const kept = before.get(candidate.id);
    if (kept && kept.candidate.excerpt?.renderId === candidate.excerpt?.renderId) return kept;
    const card = makeCard(candidate, i + 1);
    if (kept) {
      kept.parts.audio.pause();
      kept.parts.root.replaceWith(card.parts.root);
      // Carried over without touching the focus, which may be in the note (decision 0028).
      if (selection.current() === kept) {
        selection.carry(kept, card);
        card.parts.root.classList.add("selected");
      }
      if (marked === kept) {
        marked = card;
        card.parts.root.classList.add("marked");
      }
    }
    return card;
  });
  for (const card of cards) {
    if (!card.parts.root.isConnected) page.candidateGrid.append(card.parts.root);
    showRated(card);
  }
  page.noCandidates.hidden = cards.length > 0;

  page.rejectedBox.hidden = rejected.length === 0;
  page.rejectedSummary.textContent = `${rejected.length} rejected candidate${rejected.length === 1 ? "" : "s"}`;
  page.rejectedList.replaceChildren(
    ...rejected.map((candidate) => {
      const item = cloneTemplate("rejected-item", {
        line: HTMLElement,
        findings: HTMLUListElement,
      });
      const meant = candidate.intent ? `, meant as “${candidate.intent}”` : "";
      item.line.textContent = `Candidate ${candidate.id}: ${candidate.rejectReason}${meant}`;
      showFindings(item.findings, candidate.lint?.findings ?? []);
      return item.root;
    }),
  );
}

/** @param {1 | -1} step */
function cycleMacro(step) {
  const count = MACRO_NAMES.length;
  page.macroSelect.selectedIndex = (page.macroSelect.selectedIndex + step + count) % count;
  status.say(`Macro: ${page.macroSelect.value}.`);
}

page.macroSelect.replaceChildren(...MACRO_NAMES.map((name) => new Option(name, name)));

const showView = bindKeys(
  {
    session: {
      nextCandidate: () => move(1),
      previousCandidate: () => move(-1),
      playPause: () => togglePlay(heard().card.parts.audio),
      back: () => seekBy(heard().card.parts.audio, -1),
      forward: () => seekBy(heard().card.parts.audio, 1),
      thumbsUp: oneAtATime(() => thumbs(UP)),
      thumbsDown: oneAtATime(() => thumbs(DOWN)),
      writeNote: () => page.noteText.focus(),
      writeTags: () => page.tagsInput.focus(),
      previousMacro: () => cycleMacro(-1),
      nextMacro: () => cycleMacro(1),
      moreLikeThis: oneAtATime(() => macroFeedback(MORE)),
      lessLikeThis: oneAtATime(() => macroFeedback(LESS)),
      keepSketch: oneAtATime(keepSketch),
      markAb: oneAtATime(markAb),
      askCandidates,
      renderExcerpts,
      cancelJob,
      stopSession,
      toVibe: () => location.assign(`./vibe.html?id=${session.vibeId}`),
    },
    ab: ab.handlers,
  },
  "session",
  status.run,
);

status.run(async () => {
  session = await getJson(SESSION);
  showSession();
  const vibe = await getJson(`${VIBES_PATH}/${session.vibeId}`);
  page.vibeLink.href = `./vibe.html?id=${session.vibeId}`;
  page.vibeLink.textContent = vibe.revision.name;
  document.title = `Session ${sessionId}, ${vibe.revision.name} · Ambient Studio`;
  await loadRatings();
  await loadCandidates();
  showSelected();
  status.say(
    cards.length === 0
      ? "Press g to ask for candidates."
      : "Press j to select a candidate and Space to play it.",
  );
  for (const job of session.jobs) {
    if (job.finishedAt === null) status.run(() => poll(job));
  }
});

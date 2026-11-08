// The timeline page (decision 0061): one track of a brief, its sections as blocks scaled to
// time. The owner adds sketches, chooses a section and moves it, sets where it starts and how
// long it plays, and sets its crossfade, by fields, by dragging a block's edges, or by the keys
// shown on each button. The arrangement is checked as it changes by the same validator the
// server runs, and Save appends a revision. Earlier revisions are listed, and one opened can be
// saved as the newest. A section plays its own window of its sketch, rendered once by an
// owner-started job through the excerpt player.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { ArrangementSketch } from "../domain/validate-arrangement.js" */
/** @import { JobStatus } from "./job-progress.js" */
/** @import { TimelineAction } from "./timeline-keys.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { SECTION_FIELDS, SECTION_KEY, TRANSITION_SECONDS } from "../domain/arrangement-schema.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { getJson, jobPath, postJson, startJob, trackPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { clockTime, mountPlayer, playAudio } from "./excerpt-player.js";
import { followJob } from "./follow-job.js";
import { formatTime } from "./format-time.js";
import { jobControl } from "./job-control.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";
import { keyButtons } from "./key-buttons.js";
import { unloadGuard } from "./quick-ab-session.js";
import { statusLine } from "./status-line.js";
import {
  addSection,
  dragEdge,
  moveSection,
  removeSection,
  SECTION_STEP,
  setSection,
  setTransition,
  stepSection,
  stepTransition,
  TRANSITION_STEP,
  transitionOf,
} from "./timeline-edits.js";
import { bindTimelineKeys, TIMELINE_KEYS } from "./timeline-keys.js";
import { blockText, sectionCount, timelineLayout } from "./timeline-layout.js";
import { drawTimeline } from "./timeline-view.js";

const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  trackLine: HTMLElement,
  timeline: HTMLElement,
  noSections: HTMLElement,
  arrangementErrors: HTMLUListElement,
  noteInput: HTMLInputElement,
  sectionBox: HTMLElement,
  sectionName: HTMLElement,
  sectionTimes: HTMLElement,
  offsetInput: HTMLInputElement,
  secondsInput: HTMLInputElement,
  fadeField: HTMLElement,
  fadeInput: HTMLInputElement,
  fadeLine: HTMLElement,
  sectionAudio: HTMLAudioElement,
  jobBox: HTMLElement,
  addHelp: HTMLElement,
  sketchSelect: HTMLSelectElement,
  noSketches: HTMLElement,
  revisionList: HTMLUListElement,
});

/** Each action's button, which shows its key and does what the key does. */
const buttons = keyButtons(TIMELINE_KEYS);
for (const [name, words] of /** @type {[TimelineAction, string][]} */ ([
  ["shorter", `${SECTION_STEP} s shorter`],
  ["longer", `${SECTION_STEP} s longer`],
  ["startEarlier", `Start ${SECTION_STEP} s earlier`],
  ["startLater", `Start ${SECTION_STEP} s later`],
  ["fadeShorter", `Crossfade ${TRANSITION_STEP} s shorter`],
  ["fadeLonger", `Crossfade ${TRANSITION_STEP} s longer`],
])) {
  buttons[name].firstChild?.replaceWith(document.createTextNode(words));
}
page.addHelp.textContent = `The sketches you kept for this brief. A new section plays its sketch from the start, for ${clockTime(SECTION_FIELDS.seconds.default)} or the whole sketch when it is shorter, after the chosen section, with a crossfade of up to ${TRANSITION_SECONDS.default} s.`;
page.secondsInput.min = String(SECTION_FIELDS.seconds.min);
page.offsetInput.min = String(SECTION_FIELDS.offset.min);
page.fadeInput.min = String(TRANSITION_SECONDS.min);
mountPlayer(page.sectionAudio, status.fail);
const playControl = jobControl(buttons.play);

const idText = new URLSearchParams(location.search).get("id");
if (idText === null) throw new Error("track.html needs ?id=<track id>");
const trackId = Number(idText);

/**
 * The track as `GET /api/tracks/:id` gives it.
 * @typedef {object} TrackView
 * @property {{ id: number, name: string }} track
 * @property {{ id: number, name: string }} vibe
 * @property {{ id: number, arrangement: Arrangement, note: string, length: number, createdAt: number }[]} revisions
 *   oldest first
 * @property {{ id: number, candidateId: number, intent: string | null, notes: string, tags: string[], duration: number }[]} sketches
 */

/** @type {TrackView | null} */
let view = null;
/** @type {Arrangement | null} the timeline as the owner has it now */
let draft = null;
/** The arrangement as last saved or opened, as JSON, to tell an unsaved change. */
let kept = "";
/** The version the timeline was opened from, counted from 1. */
let openedVersion = 0;
/** @type {number | null} the section the keys and buttons act on */
let selected = null;
/** Each section window's audio once rendered, by the section as JSON. */
const windowAudio = /** @type {Map<string, string>} */ (new Map());

/** @param {number} id */
const sketchOf = (id) => view?.sketches.find((sketch) => sketch.id === id);

/** Whether the timeline differs from what was last saved or opened. */
const unsaved = () => draft !== null && JSON.stringify(draft) !== kept;

/**
 * The arrangement checked as the server will check it. A sketch this page doesn't list is one
 * the server no longer has live; the server's own error names why.
 * @param {Arrangement} arrangement
 */
function checked(arrangement) {
  if (view === null) throw new Error("the track isn't loaded");
  const vibeId = view.vibe.id;
  return validateArrangement(arrangement, {
    vibeId,
    sketch: (id) => {
      const sketch = sketchOf(id);
      return (
        sketch &&
        /** @type {ArrangementSketch} */ ({
          vibeId,
          removedReason: null,
          duration: sketch.duration,
        })
      );
    },
  });
}

/** Writes a number into a field unless the owner is typing in it. */
function fill(/** @type {HTMLInputElement} */ input, /** @type {number} */ value) {
  if (document.activeElement !== input) input.value = String(value);
}

/** Draws the page from `draft`, `selected` and `view`. */
function draw() {
  if (view === null || draft === null) return;
  const arrangement = draft;
  const sections = arrangement.sections;
  if (selected !== null && selected >= sections.length) selected = sections.length - 1;
  if (selected === null && sections.length > 0) selected = 0;
  if (sections.length === 0) selected = null;

  const result = checked(arrangement);
  const errors = result.ok ? [] : result.errors;
  page.arrangementErrors.hidden = errors.length === 0;
  page.arrangementErrors.replaceChildren(
    ...errors.map(({ path, message }) => {
      const item = document.createElement("li");
      item.textContent = `${path}: ${message}`;
      return item;
    }),
  );
  buttons.save.disabled = errors.length > 0;
  buttons.save.title =
    errors.length > 0
      ? "Turned off until the problems listed under the timeline are fixed."
      : "Saves the timeline as a new version of this track. Earlier versions stay as they were. Nothing is rendered.";

  const asked = [
    arrangement.length === null ? "" : `you asked for ${clockTime(arrangement.length)}`,
    arrangement.arc === null ? "" : `the arc: ${arrangement.arc}`,
  ].filter(Boolean);
  // An arrangement with errors may hold values that aren't numbers, so its length is unknown.
  const length = clockTime(errors.length === 0 ? arrangementLength(arrangement) : Number.NaN);
  page.trackLine.textContent = [
    `${length} long, ${sectionCount(sections.length)}`,
    asked.join(", "),
    unsaved() ? `Changed since version ${openedVersion}; not saved` : `Version ${openedVersion}`,
  ]
    .filter(Boolean)
    .join(". ")
    .concat(".");

  const layout = timelineLayout(arrangement);
  drawTimeline(
    page.timeline,
    {
      length: layout.length,
      fades: layout.fades,
      blocks: layout.blocks.map((span, i) => {
        const section = /** @type {Section} */ (sections[i]);
        return { span, ...blockText(section, sketchOf(section.sketchId)) };
      }),
    },
    selected,
    {
      select: (index) => {
        selected = index;
        draw();
      },
      drag: (index, edge, seconds) => edit(dragEdge(arrangement, index, edge, seconds)),
    },
  );
  page.noSections.hidden = sections.length > 0;

  page.sectionBox.hidden = selected === null;
  for (const name of /** @type {TimelineAction[]} */ (Object.keys(TIMELINE_KEYS))) {
    if (name !== "add" && name !== "save") buttons[name].disabled = selected === null;
  }
  // A render that is running keeps Play off, whatever is chosen.
  if (playControl.held()) buttons.play.disabled = true;
  if (selected === null) return;
  const section = /** @type {Section} */ (sections[selected]);
  const text = blockText(section, sketchOf(section.sketchId));
  page.sectionName.textContent = `Section ${selected + 1} of ${sections.length}: ${text.name}`;
  page.sectionTimes.textContent = `Plays ${text.times}.`;
  fill(page.offsetInput, section.offset);
  fill(page.secondsInput, section.seconds);
  buttons.selectPrevious.disabled = selected === 0;
  buttons.selectNext.disabled = selected === sections.length - 1;
  buttons.moveLeft.disabled = selected === 0;
  buttons.moveRight.disabled = selected === sections.length - 1;
  const fade = transitionOf(arrangement, selected);
  page.fadeField.hidden = fade === null;
  buttons.fadeShorter.disabled = fade === null;
  buttons.fadeLonger.disabled = fade === null;
  if (fade === null) {
    page.fadeLine.textContent = "No crossfade: the track has one section.";
  } else {
    fill(
      page.fadeInput,
      /** @type {{ seconds: number }} */ (arrangement.transitions[fade]).seconds,
    );
    page.fadeLine.textContent = `The crossfade from section ${fade + 1} into section ${fade + 2}.`;
  }
}

/**
 * Puts a new arrangement on the timeline.
 * @param {Arrangement} next
 * @param {number | null} [choose] the section to choose, or the same one when omitted
 */
function edit(next, choose) {
  draft = next;
  if (choose !== undefined) selected = choose;
  draw();
}

/**
 * Runs `change` on the timeline and the chosen section, when there is one.
 * @param {(arrangement: Arrangement, index: number) => Arrangement} change
 */
function onSelected(change) {
  if (draft === null || selected === null) return;
  edit(change(draft, selected));
}

/**
 * Moves the chosen section `step` places, and keeps it chosen.
 * @param {-1 | 1} step
 */
function onMove(step) {
  if (draft === null || selected === null) return;
  const moved = moveSection(draft, selected, step);
  edit(moved.arrangement, moved.index);
}

/** @param {number} steps */
const onFade = (steps) =>
  onSelected((arrangement, index) => {
    const fade = transitionOf(arrangement, index);
    return fade === null ? arrangement : stepTransition(arrangement, fade, steps);
  });

/**
 * A field's number, or a throw naming the field.
 * @param {HTMLInputElement} input
 * @param {string} name
 */
function fieldNumber(input, name) {
  const value = Number(input.value);
  if (input.value.trim() === "" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number of seconds.`);
  }
  return value;
}

page.offsetInput.onchange = () =>
  status.run(() => {
    const offset = fieldNumber(page.offsetInput, "Starts at");
    onSelected((arrangement, index) => setSection(arrangement, index, { offset }));
  });
page.secondsInput.onchange = () =>
  status.run(() => {
    const seconds = fieldNumber(page.secondsInput, "Plays for");
    onSelected((arrangement, index) => setSection(arrangement, index, { seconds }));
  });
page.fadeInput.onchange = () =>
  status.run(() => {
    const seconds = fieldNumber(page.fadeInput, "Crossfade");
    onSelected((arrangement, index) => {
      const fade = transitionOf(arrangement, index);
      return fade === null ? arrangement : setTransition(arrangement, fade, seconds);
    });
  });

/** Adds the chosen sketch after the chosen section. */
function add() {
  if (draft === null) return;
  const sketch = sketchOf(Number(page.sketchSelect.value));
  if (!sketch) {
    status.say("Choose a sketch to add first.");
    return;
  }
  const made = addSection(draft, sketch, selected);
  edit(made.arrangement, made.index);
  status.say(`Added sketch ${sketch.id} as section ${made.index + 1}. Save to keep it.`);
}

/** Saves the timeline as the newest revision, then reads the track again. */
async function save() {
  if (draft === null) return;
  const result = checked(draft);
  if (!result.ok) throw new Error("Fix the problems listed under the timeline first.");
  buttons.save.disabled = true;
  try {
    await postJson(`${trackPath(trackId)}/revisions`, {
      arrangement: draft,
      note: page.noteInput.value.trim(),
    });
    page.noteInput.value = "";
    await load();
    status.say(`Saved as version ${openedVersion}.`);
  } finally {
    draw();
  }
}

/**
 * Plays the chosen section's window, rendering it first with an owner-started job when this
 * page hasn't rendered that window yet.
 */
async function playSection() {
  if (draft === null || selected === null) return;
  if (!page.sectionAudio.paused) {
    page.sectionAudio.pause();
    return;
  }
  if (playControl.held()) return;
  const section = /** @type {Section} */ (draft.sections[selected]);
  const key = JSON.stringify(section);
  const known = windowAudio.get(key);
  if (known !== undefined) {
    play(known);
    return;
  }
  playControl.wait();
  try {
    const { job, refused } = await startJob(`${trackPath(trackId)}/section-audio`, section);
    status.say(
      refused ? `${refused} Showing that job's progress.` : "Rendering the section to play.",
    );
    const box = jobBox((current) =>
      status.run(async () => box.show(await postJson(`${jobPath(current.id)}/cancel`, {}))),
    );
    page.jobBox.replaceChildren(box.root);
    playControl.hold(job);
    /** @type {JobStatus & { result?: any }} */
    const finished = await followJob(job, (current) => box.show(current));
    if (finished.state !== JOB_STATE.done) {
      status.say(endedText(finished));
      return;
    }
    if (refused) {
      status.say("That job was for another window. Press Play again to render this one.");
      return;
    }
    const { url, duration } = finished.result;
    windowAudio.set(key, url);
    play(url);
    if (duration < section.seconds) {
      status.say(
        `Playing the first ${clockTime(duration)}: the rest runs past the sketch's end, which plays once tracks render.`,
      );
    }
  } finally {
    playControl.release();
    draw();
  }
}

/** @param {string} url */
function play(url) {
  const absolute = new URL(url, location.href).href;
  if (page.sectionAudio.src !== absolute) page.sectionAudio.src = url;
  playAudio(page.sectionAudio, status.fail);
}

/** Each action, run by its button and its key. */
const actions = /** @type {Record<TimelineAction, () => void>} */ ({
  selectPrevious: () => {
    if (selected !== null && selected > 0) edit(/** @type {Arrangement} */ (draft), selected - 1);
  },
  selectNext: () => {
    if (draft !== null && selected !== null && selected < draft.sections.length - 1) {
      edit(draft, selected + 1);
    }
  },
  moveLeft: () => onMove(-1),
  moveRight: () => onMove(1),
  shorter: () =>
    onSelected((arrangement, index) => stepSection(arrangement, index, SECTION_KEY.seconds, -1)),
  longer: () =>
    onSelected((arrangement, index) => stepSection(arrangement, index, SECTION_KEY.seconds, 1)),
  startEarlier: () =>
    onSelected((arrangement, index) => stepSection(arrangement, index, SECTION_KEY.offset, -1)),
  startLater: () =>
    onSelected((arrangement, index) => stepSection(arrangement, index, SECTION_KEY.offset, 1)),
  fadeShorter: () => onFade(-1),
  fadeLonger: () => onFade(1),
  add,
  remove: () => onSelected((arrangement, index) => removeSection(arrangement, index)),
  play: () => void status.run(playSection),
  save: () => void status.run(save),
});
for (const [name, action] of Object.entries(actions)) {
  buttons[/** @type {TimelineAction} */ (name)].onclick = () => status.run(action);
}
bindTimelineKeys(document, actions, () => document.activeElement);

window.addEventListener("beforeunload", unloadGuard({ unsaved }));

/**
 * Opens a revision on the timeline. Saving then makes it the newest.
 * @param {number} index its place in `view.revisions`, oldest first
 */
function openRevision(index) {
  const revision = view?.revisions[index];
  if (!revision) throw new Error(`there is no version ${index + 1}`);
  draft = structuredClone(revision.arrangement);
  kept = JSON.stringify(draft);
  openedVersion = index + 1;
  selected = draft.sections.length > 0 ? 0 : null;
}

/** Reads the track and opens its newest revision. */
async function load() {
  /** @type {TrackView} */
  const read = await getJson(trackPath(trackId));
  view = read;
  page.briefLink.href = `./brief.html?id=${read.vibe.id}`;
  page.briefLink.textContent = read.vibe.name;
  page.pageTitle.textContent = read.track.name;
  document.title = `${read.track.name}, ${read.vibe.name} · Ambient Studio`;
  page.sketchSelect.replaceChildren(
    ...read.sketches.map(
      (sketch) =>
        new Option(
          `Sketch ${sketch.id}${sketch.intent ? `: ${sketch.intent}` : ""}, ${clockTime(sketch.duration)}`,
          String(sketch.id),
        ),
    ),
  );
  page.noSketches.hidden = read.sketches.length > 0;
  buttons.add.disabled = read.sketches.length === 0;
  openRevision(read.revisions.length - 1);
  showRevisions();
  draw();
}

/** Lists the revisions, newest first, each with Open. */
function showRevisions() {
  if (view === null) return;
  const newest = view.revisions.length - 1;
  page.revisionList.replaceChildren(
    ...view.revisions
      .map((revision, index) => {
        const item = cloneTemplate("revision-item", {
          summary: HTMLElement,
          open: HTMLButtonElement,
          note: HTMLElement,
        });
        item.summary.textContent = `Version ${index + 1}${index === newest ? " (newest)" : ""}, ${formatTime(revision.createdAt)}: ${clockTime(revision.length)}, ${sectionCount(revision.arrangement.sections.length)}`;
        item.note.textContent = revision.note;
        item.note.hidden = revision.note === "";
        item.open.onclick = () =>
          status.run(() => {
            if (unsaved() && !confirm(`Replace the unsaved timeline with version ${index + 1}?`)) {
              return;
            }
            openRevision(index);
            page.noteInput.value = index === newest ? "" : `From version ${index + 1}`;
            draw();
            status.say(
              index === newest
                ? `Opened version ${index + 1}, the newest.`
                : `Opened version ${index + 1}. Save to make it the newest version.`,
            );
          });
        return item.root;
      })
      .reverse(),
  );
}

status.run(async () => {
  await load();
  status.say(
    view?.sketches.length === 0
      ? "This brief has no sketches to place yet."
      : "Choose a sketch and add it, or choose a section to change it.",
  );
});

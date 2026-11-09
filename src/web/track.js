// The timeline page (decision 0061): one track of a brief, its sections as blocks scaled to
// time. The owner adds sketches, chooses a section and moves it, sets where it starts and how
// long it plays, and sets its crossfade, by fields, by dragging a block's edges, or by the keys
// shown on each button. The owner writes what should happen in the section and in its
// transition (0077), saved with the arrangement and never part of the render. The arrangement
// is checked as it changes by the same validator the server runs, and Save appends a revision.
// Earlier revisions are listed, and one opened can be saved as the newest. A section plays its
// own window of its sketch, rendered once by an owner-started job through the excerpt player.
// The page leads with words (0087): the timeline in words, a section's length and transition and
// a lane asked in words, and the seconds, offsets and lane values behind the numbers toggle.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { ArrangementSketch } from "../domain/validate-arrangement.js" */
/** @import { SectionGenomes } from "../domain/section-genome.js" */
/** @import { BridgePlan } from "../domain/bridge-plan.js" */
/** @import { TimelineAction } from "./timeline-keys.js" */
/** @import { TrackCost } from "../domain/track-cost.js" */
/** @import { BlockSketch } from "./timeline-layout.js" */
/** @import { Curve } from "../engine/trajectory.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import {
  MAX_TEXT_CHARS,
  morphs,
  SECTION_FIELDS,
  SECTION_KEY,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "../domain/arrangement-schema.js";
import { BRIDGE_SECONDS, bridgePlan } from "../domain/bridge-plan.js";
import { DEVELOP_PLAN, developPlan } from "../domain/develop-plan.js";
import { listed } from "../domain/preference-text.js";
import { developmentKey, sectionMorph, sectionThinning } from "../domain/section-genome.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { BREED_ESTIMATE_PATH, getJson, postJson, trackPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import {
  bridgeCostText,
  bridgeRefusal,
  bridgeSkippedText,
  bridgeSwap,
  developAllCostText,
  developAllNote,
  developAllRefusal,
  developAllSwap,
  developCostText,
  developedText,
  developmentLine,
  developmentName,
  developRefusal,
  developSwap,
  runWritten,
} from "./develop-text.js";
import { elementsById } from "./element-by-id.js";
import { clockTime, mountPlayer, playAudio } from "./excerpt-player.js";
import { formatTime } from "./format-time.js";
import { jobControl } from "./job-control.js";
import { keyButtons } from "./key-buttons.js";
import { lanePanel } from "./lane-panel.js";
import { SWAP } from "./material-actions.js";
import { materialCard } from "./material-card.js";
import { pageNumbers } from "./numbers-toggle.js";
import { NOT_STARTED } from "./owner-job.js";
import { unloadGuard } from "./quick-ab-session.js";
import { runJob } from "./run-job.js";
import { sketchReadingCard } from "./sketch-reading-card.js";
import { statusLine } from "./status-line.js";
import {
  addSection,
  dragEdge,
  moveSection,
  nextCurve,
  nextTransitionKind,
  placeDevelopment,
  removeSection,
  SECTION_STEP,
  setDevelopment,
  setSection,
  setSectionText,
  setTransition,
  setTransitionText,
  stepSection,
  stepTransition,
  TRANSITION_STEP,
  transitionOf,
} from "./timeline-edits.js";
import { bindTimelineKeys, TIMELINE_KEYS } from "./timeline-keys.js";
import {
  blockText,
  placeWords,
  playedName,
  playsWords,
  sectionCount,
  timelineLayout,
} from "./timeline-layout.js";
import { drawTimeline } from "./timeline-view.js";
import { stemsText, trackRenderText } from "./track-render-text.js";
import { FIX_FIRST, trackWords } from "./track-words.js";
import { timelineWords } from "./track-words-text.js";
import { curveWords, kindButtonWords, transitionText, transitionWords } from "./transition-text.js";
import "./topbar-jobs.js";

pageNumbers("track.html");
const status = statusLine();
const page = elementsById({
  pageTitle: HTMLElement,
  briefLink: HTMLAnchorElement,
  trackLine: HTMLElement,
  timeline: HTMLElement,
  noSections: HTMLElement,
  timelineWords: HTMLOListElement,
  arrangementErrors: HTMLUListElement,
  noteInput: HTMLInputElement,
  sectionBox: HTMLElement,
  sectionName: HTMLElement,
  sectionPlays: HTMLElement,
  sectionTimes: HTMLElement,
  offsetLabel: HTMLElement,
  offsetInput: HTMLInputElement,
  secondsInput: HTMLInputElement,
  fadeField: HTMLElement,
  fadeInput: HTMLInputElement,
  fadeLine: HTMLElement,
  transitionWordsLine: HTMLElement,
  sectionTextInput: HTMLTextAreaElement,
  transitionTextField: HTMLElement,
  transitionTextLabel: HTMLElement,
  transitionTextInput: HTMLTextAreaElement,
  sectionAudio: HTMLAudioElement,
  jobBox: HTMLElement,
  developedLine: HTMLElement,
  developJobBox: HTMLElement,
  bridgeField: HTMLElement,
  bridgeSecondsInput: HTMLInputElement,
  developAgainInput: HTMLInputElement,
  developAllJobBox: HTMLElement,
  developmentList: HTMLUListElement,
  noDevelopments: HTMLElement,
  developmentSelect: HTMLSelectElement,
  addHelp: HTMLElement,
  sketchSelect: HTMLSelectElement,
  noSketches: HTMLElement,
  revisionList: HTMLUListElement,
  renderLine: HTMLElement,
  renderLoudness: HTMLElement,
  trackAudio: HTMLAudioElement,
  exportList: HTMLUListElement,
  renderJobBox: HTMLElement,
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
page.sectionTextInput.maxLength = MAX_TEXT_CHARS;
page.transitionTextInput.maxLength = MAX_TEXT_CHARS;
page.bridgeSecondsInput.min = String(BRIDGE_SECONDS.min);
page.bridgeSecondsInput.max = String(BRIDGE_SECONDS.max);
page.bridgeSecondsInput.value = String(BRIDGE_SECONDS.default);
mountPlayer(page.sectionAudio, status.fail);
mountPlayer(page.trackAudio, status.fail);
const playControl = jobControl(buttons.play);
const developControl = jobControl(buttons.develop);
/** The develop button's own title, shown while it is on. */
const DEVELOP_TITLE = buttons.develop.title;
const bridgeControl = jobControl(buttons.bridge);
/** The bridge button's own title, shown while it is on. */
const BRIDGE_TITLE = buttons.bridge.title;
const developAllControl = jobControl(buttons.developAll);
/** The whole track's develop button's own title, shown while it is on. */
const DEVELOP_ALL_TITLE = buttons.developAll.title;
/** The render, seam and export buttons share one hold: one track job runs at a time. */
const TRACK_JOB_BUTTONS = /** @type {const} */ ([
  "renderTrack",
  "playSeam",
  "exportTrack",
  "exportStems",
]);
const trackJobControls = TRACK_JOB_BUTTONS.map((name) => jobControl(buttons[name]));
/** The actions that act on the saved version rather than the chosen section. */
const VERSION_ACTIONS = new Set([
  "add",
  "save",
  "renderTrack",
  "playTrack",
  "playSeam",
  "exportTrack",
  "exportStems",
  "developAll",
]);

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
 * @property {{ id: number, candidateId: number, intent: string | null, notes: string, tags: string[], duration: number, genome: unknown, excerpt: { renderId: number, url: string, offset: number, duration: number } | null }[]} sketches
 * @property {TrackDevelopment[]} developments the track's live ones, oldest first (0079)
 */

/**
 * A development of a sketch, as `GET /api/tracks/:id` lists it (decision 0079).
 * @typedef {{ id: number, sketchId: number, text: string, offset: number, seconds: number, bridge: boolean, createdAt: number, genome: unknown }} TrackDevelopment
 */

/** @type {TrackView | null} */
let view = null;
/** @type {Arrangement | null} the timeline as the owner has it now */
let draft = null;
/** The arrangement as last saved or opened, as JSON, to tell an unsaved change. */
let kept = "";
/** The version the timeline was opened from, counted from 1. */
let openedVersion = 0;
/** How many times a version was opened by hand from the list, which a steer's swap reads. */
let openedByHand = 0;
/** @type {number | null} the section the keys and buttons act on */
let selected = null;
/** Each section window's audio once rendered, by its sketch, development, offset and seconds. */
const windowAudio = /** @type {Map<string, string>} */ (new Map());

/**
 * The opened version's render, as `GET …/revisions/:id/render` gives it.
 * @typedef {object} RenderView
 * @property {{ cost: TrackCost, rate: number, measured: boolean }} estimate
 * @property {{ url: string, seconds: number, loudness: { integrated: number, truePeak: number } } | null} preview
 * @property {{ transition: number, url: string, from: number }[]} seams
 * @property {string} folder the export's folder name
 * @property {string[]} stems the voice ids an export with stems writes one each for
 * @property {{ kind: string, folder: string, createdAt: number }[]} exports
 */

/** @type {RenderView | null} null while it is read, or when the version has no sections */
let rendered = null;
/** Track seconds at the start of what the track player plays: 0, or a seam preview's start. */
let playedFrom = 0;
const playhead = document.createElement("div");
playhead.className = "timeline-playhead";
playhead.hidden = true;

/** @param {number} id */
const sketchOf = (id) => view?.sketches.find((sketch) => sketch.id === id);

/** @param {number | null} id */
const developmentOf = (id) => view?.developments.find((development) => development.id === id);

/** Whether the timeline differs from what was last saved or opened. */
const unsaved = () => draft !== null && JSON.stringify(draft) !== kept;

/**
 * The arrangement checked as the server will check it. A sketch or development this page
 * doesn't list is one the server no longer has live; the server's own error names why.
 * @param {Arrangement} arrangement
 */
function checked(arrangement) {
  if (view === null) throw new Error("the track isn't loaded");
  const vibeId = view.vibe.id;
  return validateArrangement(arrangement, {
    vibeId,
    trackId,
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
    development: (id) => {
      const development = developmentOf(id);
      return (
        development && {
          trackId,
          sketchId: development.sketchId,
          removedReason: null,
          duration: development.seconds,
        }
      );
    },
  });
}

/** Writes a value into a field unless the owner is typing in it. */
function fill(
  /** @type {HTMLInputElement | HTMLTextAreaElement} */ input,
  /** @type {number | string} */ value,
) {
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
      ? FIX_FIRST
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
        return {
          span,
          ...blockText(section, sketchOf(section.sketchId), developmentOf(section.developmentId)),
        };
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
  page.timelineWords.replaceChildren(
    ...timelineWords(arrangement, sketchOf, developmentOf).map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
  lanes.draw();
  words.draw(errors.length === 0);
  material.draw(errors.length === 0);

  page.sectionBox.hidden = selected === null;
  reading.show(selected === null ? null : /** @type {Section} */ (sections[selected]).sketchId);
  page.timeline.append(playhead);
  drawRender();
  for (const name of /** @type {TimelineAction[]} */ (Object.keys(TIMELINE_KEYS))) {
    if (!VERSION_ACTIONS.has(name)) buttons[name].disabled = selected === null;
  }
  // A render that is running keeps Play off, whatever is chosen.
  if (playControl.held()) buttons.play.disabled = true;
  drawDevelopments(arrangement, errors.length === 0);
  if (selected === null) return;
  const section = /** @type {Section} */ (sections[selected]);
  const development = developmentOf(section.developmentId);
  const text = blockText(section, sketchOf(section.sketchId), development);
  page.sectionName.textContent = `Section ${selected + 1} of ${sections.length}: ${text.name}`;
  page.sectionPlays.textContent = `${placeWords(arrangement, selected)} ${playsWords(section, sketchOf(section.sketchId), development)}`;
  page.sectionTimes.textContent = `Plays ${text.times}.`;
  // A developed section plays its development's own timeline, from 0 when it was placed (0079).
  page.offsetLabel.textContent = `Starts at, in seconds of ${playedName(development)}`;
  page.developedLine.textContent = developedText(development);
  if (!developControl.held()) {
    const refusal = developRefusal(section, unsaved());
    buttons.develop.disabled = refusal !== null;
    buttons.develop.title = refusal ?? DEVELOP_TITLE;
  }
  buttons.plainSketch.disabled = section.developmentId === null;
  fill(page.offsetInput, section.offset);
  fill(page.secondsInput, section.seconds);
  fill(page.sectionTextInput, section.text);
  buttons.selectPrevious.disabled = selected === 0;
  buttons.selectNext.disabled = selected === sections.length - 1;
  buttons.moveLeft.disabled = selected === 0;
  buttons.moveRight.disabled = selected === sections.length - 1;
  const fade = transitionOf(arrangement, selected);
  page.fadeField.hidden = fade === null;
  page.transitionTextField.hidden = fade === null;
  buttons.fadeShorter.disabled = fade === null;
  buttons.fadeLonger.disabled = fade === null;
  buttons.morph.disabled = fade === null;
  const transition = fade === null ? undefined : arrangement.transitions[fade];
  const morphing = transition !== undefined && morphs(transition.kind);
  buttons.curve.disabled = !morphing;
  label(buttons.morph, kindButtonWords(transition?.kind ?? TRANSITION_KIND.crossfade));
  label(
    buttons.curve,
    morphing ? `Curve: ${curveWords(/** @type {Curve} */ (transition.curve))}` : "Curve",
  );
  if (fade === null || transition === undefined) {
    page.fadeLine.textContent = "No crossfade: the track has one section.";
    page.transitionWordsLine.textContent = "The track has one section, so no join.";
  } else {
    const join = transitionWords(fade, transition);
    page.transitionWordsLine.textContent = `${join.charAt(0).toUpperCase()}${join.slice(1)}.`;
    fill(page.fadeInput, transition.seconds);
    fill(page.transitionTextInput, transition.text);
    page.transitionTextLabel.textContent = `How section ${fade + 1} should become section ${fade + 2}`;
    // A morph is checked against both sketches' genomes only once the timeline is valid.
    const morph = errors.length === 0 ? sectionMorph(arrangement, fade, sectionGenomes()) : null;
    page.fadeLine.textContent = transitionText(fade, transition, morph);
  }
  page.bridgeField.hidden = fade === null;
  label(buttons.bridge, fade === null ? "Bridge" : `Bridge sections ${fade + 1} and ${fade + 2}`);
  if (!bridgeControl.held()) {
    const refusal =
      errors.length > 0
        ? FIX_FIRST
        : bridgeRefusal(arrangement, fade, bridgeSeconds(), unsaved(), sectionGenomes());
    buttons.bridge.disabled = refusal !== null;
    buttons.bridge.title = refusal ?? BRIDGE_TITLE;
  }
}

/**
 * What Develop every section would do with each section of `arrangement` (decision 0082).
 * @param {Arrangement} arrangement
 */
const developAllPlan = (arrangement) =>
  developPlan(
    arrangement,
    page.developAgainInput.checked,
    (id) => developmentOf(id)?.bridge === true,
  );

/**
 * Draws the Developments card: every development of the track with the sections that play it
 * now, the select to place one, and whether Develop every section is on.
 * @param {Arrangement} arrangement
 * @param {boolean} valid
 */
function drawDevelopments(arrangement, valid) {
  const developments = view?.developments ?? [];
  /** @param {number} id */
  const playedIn = (id) =>
    arrangement.sections.flatMap(({ developmentId }, i) => (developmentId === id ? [i] : []));
  page.developmentList.replaceChildren(
    ...developments.map((development) => {
      const item = document.createElement("li");
      item.textContent = developmentLine(development, playedIn(development.id));
      return item;
    }),
  );
  page.noDevelopments.hidden = developments.length > 0;
  const chosen = page.developmentSelect.value;
  page.developmentSelect.replaceChildren(
    ...developments.map(
      (development) => new Option(developmentName(development), String(development.id)),
    ),
  );
  if (developments.some(({ id }) => String(id) === chosen)) {
    page.developmentSelect.value = chosen;
  }
  buttons.placeDevelopment.disabled = selected === null || developments.length === 0;
  if (!developAllControl.held()) {
    const refusal = valid ? developAllRefusal(developAllPlan(arrangement), unsaved()) : FIX_FIRST;
    buttons.developAll.disabled = refusal !== null;
    buttons.developAll.title = refusal ?? DEVELOP_ALL_TITLE;
  }
}

/** The bridge's seconds as the owner typed them; NaN when the field holds no number. */
const bridgeSeconds = () =>
  page.bridgeSecondsInput.value.trim() === "" ? Number.NaN : Number(page.bridgeSecondsInput.value);

/**
 * Puts `words` on a key button, before the key it shows.
 * @param {HTMLButtonElement} button
 * @param {string} words
 */
function label(button, words) {
  button.firstChild?.replaceWith(document.createTextNode(words));
}

/**
 * Each sketch's genome by its id, and each development's by its key, as `sectionMorph` reads
 * them (0079).
 * @returns {SectionGenomes}
 */
const sectionGenomes = () =>
  new Map(
    /** @type {[number | string, unknown][]} */ ([
      ...(view?.sketches ?? []).map(({ id, genome }) => [id, genome]),
      ...(view?.developments ?? []).map(({ id, genome }) => [developmentKey(id), genome]),
    ]),
  );

/**
 * Puts a new arrangement on the timeline.
 * @param {Arrangement} next
 * @param {number | null} [choose] the section to choose, or the same one when omitted
 */
function edit(next, choose) {
  words.edited(next);
  draft = next;
  if (choose !== undefined) selected = choose;
  draw();
  // An edit back to the saved version makes it renderable again.
  if (!unsaved() && rendered === null) void status.run(readRender);
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

/**
 * Runs `change` on the chosen section's transition, when there is one.
 * @param {(arrangement: Arrangement, index: number) => Arrangement} change
 */
const onTransition = (change) =>
  onSelected((arrangement, index) => {
    const fade = transitionOf(arrangement, index);
    return fade === null ? arrangement : change(arrangement, fade);
  });

/** @param {number} steps */
const onFade = (steps) =>
  onTransition((arrangement, fade) => stepTransition(arrangement, fade, steps));

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
// The bridge's seconds are the page's, not the timeline's: they only turn Bridge on or off.
page.bridgeSecondsInput.onchange = () => draw();
page.fadeInput.onchange = () =>
  status.run(() => {
    const seconds = fieldNumber(page.fadeInput, "Crossfade");
    onSelected((arrangement, index) => {
      const fade = transitionOf(arrangement, index);
      return fade === null ? arrangement : setTransition(arrangement, fade, seconds);
    });
  });

page.sectionTextInput.onchange = () => {
  const text = page.sectionTextInput.value;
  onSelected((arrangement, index) => setSectionText(arrangement, index, text));
};
page.transitionTextInput.onchange = () => {
  const text = page.transitionTextInput.value;
  onTransition((arrangement, fade) => setTransitionText(arrangement, fade, text));
};

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
  // The window alone, of the sketch or of its development: text doesn't change what it plays.
  const key = JSON.stringify([
    section.sketchId,
    section.developmentId,
    section.offset,
    section.seconds,
  ]);
  const known = windowAudio.get(key);
  if (known !== undefined) {
    play(known);
    return;
  }
  try {
    const finished = await runJob(status, {
      path: `${trackPath(trackId)}/section-audio`,
      body: section,
      controls: [playControl],
      boxes: page.jobBox,
      started: "Rendering the section to play.",
    });
    if (finished === null) return;
    if (finished.refused) {
      status.say("That job was for another window. Press Play again to render this one.");
      return;
    }
    const { url, duration } = finished.result;
    windowAudio.set(key, url);
    material.remeasure();
    play(url);
    if (duration < section.seconds) {
      status.say(
        `Playing the first ${clockTime(duration)}: the rest runs past the sketch's end, which plays once tracks render.`,
      );
    }
  } finally {
    draw();
  }
}

/** @param {string} url */
function play(url) {
  const absolute = new URL(url, location.href).href;
  if (page.sectionAudio.src !== absolute) page.sectionAudio.src = url;
  playAudio(page.sectionAudio, status.fail);
}

/** The opened version's id, counted as the server stores it. */
const openedRevisionId = () => {
  const revision = view?.revisions[openedVersion - 1];
  if (!revision) throw new Error(`there is no version ${openedVersion}`);
  return revision.id;
};

/** Reads the opened version's render state, then draws it. */
async function readRender() {
  rendered = null;
  drawRender();
  if (draft === null || draft.sections.length === 0 || unsaved()) return;
  const id = openedRevisionId();
  /** @type {RenderView} */
  const read = await getJson(`${trackPath(trackId)}/revisions/${id}/render`);
  if (openedRevisionId() === id) rendered = read;
  drawRender();
}

/** Draws the render card from `rendered`: what is rendered and exported, and which buttons work. */
function drawRender() {
  const held = trackJobControls.some((control) => control.held());
  const fade = draft === null || selected === null ? null : transitionOf(draft, selected);
  /** @type {[string, boolean][]} */
  const ready = [
    ["renderTrack", rendered !== null && !held],
    ["playTrack", rendered?.preview != null],
    ["playSeam", rendered !== null && fade !== null && !held],
    ["exportTrack", rendered?.preview != null && rendered.exports.length === 0 && !held],
    ["exportStems", rendered?.preview != null && rendered.exports.length === 0 && !held],
  ];
  // The card acts on the saved version, so an unsaved timeline turns it off.
  const saved = !unsaved();
  for (const [name, on] of ready) {
    buttons[/** @type {TimelineAction} */ (name)].disabled = !(on && saved);
  }
  page.renderLoudness.textContent = "";
  if (draft === null || draft.sections.length === 0) {
    page.renderLine.textContent = "Add a section and save to render the track.";
  } else if (unsaved()) {
    page.renderLine.textContent = "Save the timeline first: only a saved version renders.";
  } else if (rendered === null) {
    page.renderLine.textContent = `Reading version ${openedVersion}'s render…`;
  } else if (rendered.preview === null) {
    page.renderLine.textContent = `Version ${openedVersion} isn't rendered yet.`;
  } else {
    const { seconds, loudness } = rendered.preview;
    page.renderLine.textContent = `Version ${openedVersion} is rendered: ${clockTime(seconds)}, at the brief's loudness.`;
    page.renderLoudness.textContent = `${loudness.integrated.toFixed(1)} LUFS, its peak ${loudness.truePeak.toFixed(1)} dBTP.`;
  }
  page.exportList.replaceChildren(
    ...(rendered?.exports ?? []).map(({ kind, folder, createdAt }) => {
      const item = document.createElement("li");
      const what = kind === "stems" ? "with stems " : "";
      item.textContent = `Exported ${what}${formatTime(createdAt)} to the folder ${folder} in the studio's exports folder.`;
      return item;
    }),
  );
}

/**
 * Starts a track job by its route, follows it in the render card, and returns its result once
 * done, or null when it stopped or failed.
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {string} started what the status line says once it has started
 * @returns {Promise<any>}
 */
async function trackJob(path, body, started) {
  try {
    const finished = await runJob(status, {
      path,
      body,
      controls: trackJobControls,
      boxes: page.renderJobBox,
      started,
    });
    return finished === null || finished.refused ? null : finished.result;
  } finally {
    draw();
  }
}

/** Renders the opened version after a confirm stating its estimate. */
async function renderTrack() {
  if (rendered === null) return;
  if (!confirm(trackRenderText(rendered.estimate.cost, rendered.estimate))) {
    status.say(NOT_STARTED);
    return;
  }
  const result = await trackJob(
    `${trackPath(trackId)}/render`,
    { revisionId: openedRevisionId() },
    "Rendering the track.",
  );
  if (result === null) return;
  await readRender();
  status.say(
    result.cached ? "This version was already rendered." : "Rendered. Press Play the track.",
  );
}

/**
 * Plays `url` in the track player, its first second at `from` on the track.
 * @param {string} url
 * @param {number} from
 */
function playTrackAudio(url, from) {
  const absolute = new URL(url, location.href).href;
  if (page.trackAudio.src !== absolute) {
    page.trackAudio.src = url;
    playedFrom = from;
  }
  playAudio(page.trackAudio, status.fail);
}

/** Plays or pauses the rendered track. */
function playTrack() {
  const preview = rendered?.preview;
  if (!preview) return;
  const absolute = new URL(preview.url, location.href).href;
  if (page.trackAudio.src === absolute && !page.trackAudio.paused) {
    page.trackAudio.pause();
    return;
  }
  playTrackAudio(preview.url, 0);
}

/** Plays the 30 s around the chosen section's crossfade, rendering them first when needed. */
async function playSeam() {
  if (draft === null || selected === null || rendered === null) return;
  const transition = transitionOf(draft, selected);
  if (transition === null) return;
  const known = rendered.seams.find((seam) => seam.transition === transition);
  if (known) {
    playTrackAudio(known.url, known.from);
    return;
  }
  const result = await trackJob(
    `${trackPath(trackId)}/seam-preview`,
    { revisionId: openedRevisionId(), transition },
    `Rendering the crossfade from section ${transition + 1} into section ${transition + 2}.`,
  );
  if (result === null) return;
  await readRender();
  playTrackAudio(result.url, result.from);
}

/** Exports the rendered version into a new folder. */
async function exportTrack() {
  if (!rendered?.preview) return;
  const result = await trackJob(
    `${trackPath(trackId)}/export`,
    { revisionId: openedRevisionId() },
    "Writing the WAV, the FLAC and the manifest.",
  );
  if (result === null) return;
  await readRender();
  status.say(`Exported to ${result.path}.`);
}

/** Exports the rendered version with one stem per voice, after a confirm stating their time. */
async function exportStems() {
  if (!rendered?.preview) return;
  if (!confirm(stemsText(rendered.estimate.cost, rendered.estimate, rendered.stems))) {
    status.say(NOT_STARTED);
    return;
  }
  const result = await trackJob(
    `${trackPath(trackId)}/export`,
    { revisionId: openedRevisionId(), kind: "stems" },
    `Writing the WAV, the FLAC, ${rendered.stems.length} stems and the manifest.`,
  );
  if (result === null) return;
  await readRender();
  status.say(`Exported with stems to ${result.path}.`);
}

/** Moves the playhead to where the track player has reached. */
function movePlayhead() {
  const length = draft === null ? 0 : arrangementLength(draft);
  const at = playedFrom + page.trackAudio.currentTime;
  playhead.hidden = !(length > 0) || page.trackAudio.src === "";
  playhead.style.left = `${Math.min(100, (at / length) * 100)}%`;
}
page.trackAudio.addEventListener("timeupdate", movePlayhead);
page.trackAudio.addEventListener("seeked", movePlayhead);

/**
 * Runs `action` only while its button is on, since a key presses it whatever the button shows:
 * the render card is off while the timeline is unsaved or a track job runs.
 * @param {TimelineAction} name
 * @param {() => Promise<void>} action
 */
const whenOn = (name, action) => () => {
  if (!buttons[name].disabled) void status.run(action);
};

/**
 * Develops the chosen section of the saved version after a confirm stating the requests and
 * their time (decision 0079). When the job is done, the section takes the development by
 * `developSwap`, saved as a new version unless the timeline has changes the owner hasn't saved.
 */
async function developSection() {
  if (draft === null || selected === null || buttons.develop.disabled) return;
  const at = selected;
  const from = /** @type {Section} */ (draft.sections[at]);
  if (!confirm(developCostText(at, from.seconds, await getJson(BREED_ESTIMATE_PATH)))) {
    status.say(NOT_STARTED);
    return;
  }
  const openedThen = openedByHand;
  try {
    const finished = await runJob(status, {
      path: `${trackPath(trackId)}/develop`,
      body: { revisionId: openedRevisionId(), section: at },
      controls: [developControl],
      boxes: page.developJobBox,
      started: `Developing section ${at + 1}. Leave this page open: the section takes the development when it is done.`,
    });
    if (finished === null) return;
    if (finished.refused) {
      status.say("That job was for another section. Press Develop again for this one.");
      return;
    }
    /** @type {{ developmentId: number }} */
    const { developmentId } = finished.result;
    await readDevelopments();
    const current = /** @type {Arrangement} */ (draft);
    const swap = developSwap(
      { arrangement: current, from, at, openedThen, openedNow: openedByHand, unsaved: unsaved() },
      developmentId,
    );
    if (swap.kind === SWAP.skip) {
      status.say(
        `Kept development ${developmentId} but didn't put it in a section: ${swap.reason}. It is listed under Developments, to place by hand.`,
      );
      return;
    }
    if (swap.kind === SWAP.edit) {
      edit(swap.arrangement, swap.index);
      status.say(`Put development ${developmentId} in section ${swap.index + 1}. Save to keep it.`);
      return;
    }
    draft = swap.arrangement;
    page.noteInput.value = `Section ${swap.index + 1} developed`;
    await save();
  } finally {
    draw();
  }
}

/** Reads the track's developments again, leaving the timeline as it is. */
async function readDevelopments() {
  /** @type {TrackView} */
  const read = await getJson(trackPath(trackId));
  if (view === null) throw new Error("the developments were read again before the track");
  view = { ...view, developments: read.developments };
}

/** Has the chosen section play its plain sketch again, from where its development started. */
function plainSketch() {
  onSelected((arrangement, index) => {
    const { developmentId } = /** @type {Section} */ (arrangement.sections[index]);
    if (developmentId === null) return arrangement;
    const development = developmentOf(developmentId);
    if (!development) throw new Error(`development ${developmentId} isn't this track's`);
    return setDevelopment(arrangement, index, null, development.offset);
  });
}

/**
 * Writes a bridge for the chosen section's transition of the saved version, after a confirm
 * stating the requests and their time (decision 0081). When the job is done, the bridge goes
 * between the two sections by `bridgeSwap`, saved as a new version unless the timeline has
 * changes the owner hasn't saved.
 */
async function bridgeJoin() {
  if (draft === null || selected === null || buttons.bridge.disabled) return;
  const at = transitionOf(draft, selected);
  if (at === null) return;
  const seconds = bridgeSeconds();
  const plan = bridgePlan(draft, at, seconds, sectionGenomes());
  if (!plan.ok) throw new Error(`Can't bridge this join: ${plan.reason}.`);
  if (!confirm(bridgeCostText(at, plan, await getJson(BREED_ESTIMATE_PATH)))) {
    status.say(NOT_STARTED);
    return;
  }
  const from = /** @type {Section} */ (draft.sections[at]);
  const into = /** @type {Section} */ (draft.sections[at + 1]);
  const { text } = /** @type {{ text: string }} */ (draft.transitions[at]);
  const openedThen = openedByHand;
  try {
    const finished = await runJob(status, {
      path: `${trackPath(trackId)}/bridge`,
      body: { revisionId: openedRevisionId(), transition: at, seconds },
      controls: [bridgeControl],
      boxes: page.developJobBox,
      started: `Writing a bridge between sections ${at + 1} and ${at + 2}. Leave this page open: it goes between them when it is done.`,
    });
    if (finished === null) return;
    if (finished.refused) {
      status.say("That job was for another join. Press Bridge again for this one.");
      return;
    }
    /** @type {{ developmentIds: number[], plan: BridgePlan }} */
    const result = finished.result;
    await readDevelopments();
    const swap = bridgeSwap(
      {
        arrangement: /** @type {Arrangement} */ (draft),
        from,
        into,
        at,
        openedThen,
        openedNow: openedByHand,
        unsaved: unsaved(),
      },
      result,
      text,
    );
    const ids = listed(result.developmentIds.map(String));
    if (swap.kind === SWAP.skip) {
      status.say(bridgeSkippedText(at, ids, swap.reason));
      return;
    }
    if (swap.kind === SWAP.edit) {
      edit(swap.arrangement, swap.index + 1);
      status.say(`Put bridge ${ids} after section ${swap.index + 1}. Save to keep it.`);
      return;
    }
    draft = swap.arrangement;
    selected = swap.index + 1;
    page.noteInput.value = `Bridge between sections ${swap.index + 1} and ${swap.index + 1 + result.developmentIds.length + 1}`;
    await save();
  } finally {
    draw();
  }
}

/**
 * Develops every section of the saved version in order after a confirm counting the requests
 * (decision 0082). However the job ends, the developments it stored go into their sections by
 * `developAllSwap`, saved as one new version unless the timeline has changes not saved.
 */
async function developAll() {
  if (draft === null || buttons.developAll.disabled) return;
  const plan = developAllPlan(draft);
  const refusal = developAllRefusal(plan, unsaved());
  if (refusal !== null) throw new Error(refusal);
  if (!confirm(developAllCostText(plan, await getJson(BREED_ESTIMATE_PATH)))) {
    status.say(NOT_STARTED);
    return;
  }
  const { sections } = /** @type {Arrangement} */ (draft);
  // Read right before the run, so a row another tab's job stores while the confirm is open
  // isn't taken for the run's when it is cancelled and has no result.
  await readDevelopments();
  const known = new Set((view?.developments ?? []).map(({ id }) => id));
  const openedThen = openedByHand;
  try {
    const finished = await runJob(status, {
      path: `${trackPath(trackId)}/develop-all`,
      body: { revisionId: openedRevisionId(), again: page.developAgainInput.checked },
      controls: [developAllControl],
      boxes: page.developAllJobBox,
      started:
        "Developing every section in turn. Leave this page open: the sections take their developments when it ends.",
    });
    await readDevelopments();
    if (finished?.refused) {
      status.say(
        "That job was started from another page. Its developments are listed under Developments, to place by hand.",
      );
      return;
    }
    const written = runWritten(
      plan,
      sections,
      finished === null ? null : finished.result,
      known,
      view?.developments ?? [],
    );
    // A run stopped before its first development: the status line already says how it ended.
    if (written.length === 0) return;
    const swap = developAllSwap(
      {
        arrangement: /** @type {Arrangement} */ (draft),
        openedThen,
        openedNow: openedByHand,
        unsaved: unsaved(),
      },
      written,
    );
    const asked = plan.filter((kind) => kind === DEVELOP_PLAN.develop).length;
    const stopped =
      finished === null ? `The job ended after ${written.length} of ${asked} sections. ` : "";
    const skipped = swap.skipped
      .map(
        ({ developmentId, reason }) =>
          `Kept development ${developmentId} but didn't put it in a section: ${reason}. `,
      )
      .join("");
    const placed = `development${swap.placed.length === 1 ? "" : "s"} ${listed(swap.placed.map(({ developmentId }) => String(developmentId)))}`;
    if (swap.kind === SWAP.skip) {
      status.say(`${stopped}${skipped}They are listed under Developments, to place by hand.`);
      return;
    }
    if (swap.kind === SWAP.edit) {
      edit(swap.arrangement);
      status.say(`${stopped}${skipped}Put ${placed} in place. Save to keep them.`);
      return;
    }
    draft = swap.arrangement;
    page.noteInput.value = developAllNote(swap.placed);
    await save();
    status.say(`${stopped}${skipped}Put ${placed} in place, saved as version ${openedVersion}.`);
  } finally {
    draw();
  }
}

/**
 * Has the chosen section play the development chosen in the Developments card, as an unsaved
 * edit, when the timeline is still valid with it.
 */
function placeChosenDevelopment() {
  if (draft === null || selected === null) return;
  const development = developmentOf(Number(page.developmentSelect.value));
  if (!development) {
    status.say("Choose a development to place first.");
    return;
  }
  const next = placeDevelopment(draft, selected, development);
  const result = checked(next);
  if (!result.ok) {
    const [first] = result.errors;
    status.say(
      `Can't place development ${development.id} in section ${selected + 1}: ${first?.path}: ${first?.message}.`,
    );
    return;
  }
  edit(next);
  status.say(`Put development ${development.id} in section ${selected + 1}. Save to keep it.`);
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
  morph: () => onTransition(nextTransitionKind),
  curve: () => onTransition(nextCurve),
  add,
  remove: () => onSelected((arrangement, index) => removeSection(arrangement, index)),
  play: () => void status.run(playSection),
  save: () => void status.run(save),
  renderTrack: whenOn("renderTrack", renderTrack),
  playTrack: whenOn("playTrack", async () => playTrack()),
  playSeam: whenOn("playSeam", playSeam),
  exportTrack: whenOn("exportTrack", exportTrack),
  exportStems: whenOn("exportStems", exportStems),
  develop: () => void status.run(developSection),
  bridge: () => void status.run(bridgeJoin),
  plainSketch: () => {
    if (!buttons.plainSketch.disabled) plainSketch();
  },
  developAll: () => void status.run(developAll),
  placeDevelopment: () => {
    if (!buttons.placeDevelopment.disabled) placeChosenDevelopment();
  },
});
page.developAgainInput.onchange = () => draw();
for (const [name, action] of Object.entries(actions)) {
  buttons[/** @type {TimelineAction} */ (name)].onclick = () => status.run(action);
}
bindTimelineKeys(document, actions, () => document.activeElement);

// The macro lanes (0065) edit the same draft, through `edit`, and bind their own keys.
const lanes = lanePanel({
  draft: () => draft,
  edit: (next) => edit(next),
  status,
  thinned: () => {
    const arrangement = draft;
    if (arrangement === null || !checked(arrangement).ok) return [];
    const genomes = sectionGenomes();
    return arrangement.sections.map((_, i) => sectionThinning(arrangement, i, genomes));
  },
});

window.addEventListener("beforeunload", unloadGuard({ unsaved }));

/**
 * Opens a revision on the timeline. Saving then makes it the newest.
 * @param {number} index its place in `view.revisions`, oldest first
 */
function openRevision(index) {
  const revision = view?.revisions[index];
  if (!revision) throw new Error(`there is no version ${index + 1}`);
  rendered = null;
  page.trackAudio.pause();
  page.trackAudio.removeAttribute("src");
  playhead.hidden = true;
  words.clear();
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
  listSketches(read.sketches);
  openRevision(read.revisions.length - 1);
  showRevisions();
  draw();
  await readRender();
}

/**
 * Lists the brief's sketches to add.
 * @param {readonly BlockSketch[]} sketches
 */
function listSketches(sketches) {
  const chosen = page.sketchSelect.value;
  page.sketchSelect.replaceChildren(
    ...sketches.map(
      (sketch) =>
        new Option(
          `Sketch ${sketch.id}${sketch.intent ? `: ${sketch.intent}` : ""}, ${clockTime(sketch.duration)}`,
          String(sketch.id),
        ),
    ),
  );
  if (sketches.some(({ id }) => String(id) === chosen)) page.sketchSelect.value = chosen;
  page.noSketches.hidden = sketches.length > 0;
  buttons.add.disabled = sketches.length === 0;
}

// The material panel and the arc (decision 0066) keep to their own module and keys.
const material = materialCard({
  status,
  trackId,
  view: () => view,
  draft: () => draft,
  selected: () => selected,
  unsaved,
  opened: () => openedByHand,
  place: ({ arrangement, index }) => edit(arrangement, index),
  readSketches: async () => {
    /** @type {TrackView} */
    const read = await getJson(trackPath(trackId));
    if (view === null) throw new Error("the sketches were read again before the track");
    view = { ...view, sketches: read.sketches };
    listSketches(read.sketches);
    return read.sketches;
  },
  save: async (arrangement, note) => {
    draft = arrangement;
    page.noteInput.value = note;
    await save();
  },
});

// What the model reads of the chosen section's sketch (decision 0078) keeps to its own module.
const reading = sketchReadingCard(status);

// A section's length and transition, and a lane, asked in words (decision 0087).
const words = trackWords({
  status,
  trackId,
  vibeId: () => view?.vibe.id ?? null,
  draft: () => draft,
  selected: () => selected,
  lane: () => lanes.macro(),
  edit: (next) => edit(next),
  checked: (arrangement) => checked(arrangement),
  draw: () => draw(),
});

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
            openedByHand += 1;
            page.noteInput.value = index === newest ? "" : `From version ${index + 1}`;
            draw();
            void status.run(readRender);
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
  await material.load();
});

// The track page's words (decision 0087): the chosen section's Change it field, read into its
// length or its transition, and the chosen lane's, each through the words route as one
// owner-started job in the words lane. The page sends the timeline as it is and names the part;
// the answer is applied with the set's own `apply`, checked by the arrangement validator, and
// fills the timeline unsaved with Keep and Undo, as a session card's does (0085). One answer is
// open at a time; an edit of the timeline while one is open keeps it.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { StatusLine } from "./status-line.js" */
import { TRACK_TARGET } from "../domain/track-words.js";
import { WORDS_SETS, wordsSet } from "../domain/words-sets.js";
import { VIBES_PATH } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { jobControl } from "./job-control.js";
import { NO_SECTION } from "./material-actions.js";
import { runJob } from "./run-job.js";
import { transitionOf } from "./timeline-edits.js";
import { trackChangeLines } from "./track-words-text.js";
import { WORDS_SAY } from "./words-edits.js";

/** The track's sets by what they change, by name. */
const SET_NAMES = Object.keys(WORDS_SETS);

/**
 * The names of the sets that change `kind`.
 * @param {string} kind a `TRACK_TARGET` value
 */
const setsOf = (kind) => SET_NAMES.filter((name) => wordsSet(name)?.target === kind);

/** The sets the section's select offers, in the registry's order. */
const SECTION_SETS = [...setsOf(TRACK_TARGET.section), ...setsOf(TRACK_TARGET.transition)];

/** The lane's set. */
const LANE_SET = /** @type {string} */ (setsOf(TRACK_TARGET.macro)[0]);
if (wordsSet(LANE_SET) === undefined) throw new Error("the field sets have no lane's set");

/** Why a button that reads the timeline is off while the timeline has errors. */
export const FIX_FIRST = "Turned off until the problems listed under the timeline are fixed.";

/**
 * @typedef {object} WordsArea
 * @property {HTMLInputElement} input
 * @property {HTMLButtonElement} button
 * @property {HTMLElement} job
 * @property {HTMLElement} answer
 * @property {string} idle the button's own title
 */

/**
 * An answer filled in and not yet kept or undone.
 * @typedef {{ area: WordsArea, before: Arrangement, after: Arrangement }} Pending
 */

/**
 * Mounts the words fields on the track page.
 * @param {object} host
 * @param {StatusLine} host.status
 * @param {number} host.trackId
 * @param {() => number | null} host.vibeId null until the track is read
 * @param {() => Arrangement | null} host.draft the timeline as the owner has it now
 * @param {() => number | null} host.selected the chosen section
 * @param {() => MacroName} host.lane the chosen lane
 * @param {(next: Arrangement) => void} host.edit puts a new arrangement on the timeline
 * @param {(arrangement: Arrangement) => { ok: true } | { ok: false, errors: ValidationError[] }} host.checked
 *   the page's arrangement validator
 * @param {() => void} host.draw draws the page again
 */
export function trackWords(host) {
  const parts = elementsById({
    sectionWordsInput: HTMLInputElement,
    sectionWordsSet: HTMLSelectElement,
    sectionWords: HTMLButtonElement,
    sectionWordsJob: HTMLElement,
    sectionWordsAnswer: HTMLElement,
    laneWordsInput: HTMLInputElement,
    laneWords: HTMLButtonElement,
    laneWordsJob: HTMLElement,
    laneWordsAnswer: HTMLElement,
  });
  /** @type {WordsArea} */
  const section = {
    input: parts.sectionWordsInput,
    button: parts.sectionWords,
    job: parts.sectionWordsJob,
    answer: parts.sectionWordsAnswer,
    idle: parts.sectionWords.title,
  };
  /** @type {WordsArea} */
  const lane = {
    input: parts.laneWordsInput,
    button: parts.laneWords,
    job: parts.laneWordsJob,
    answer: parts.laneWordsAnswer,
    idle: parts.laneWords.title,
  };
  const controls = [jobControl(section.button), jobControl(lane.button)];
  /** @type {Pending | null} */
  let pending = null;

  /** @param {WordsArea} area */
  const close = (area) => area.answer.replaceChildren();

  /**
   * What `set` changes on the timeline now, or null when there is none to change.
   * @param {string} set
   * @param {Arrangement} arrangement
   * @returns {number | string | null}
   */
  function targetOf(set, arrangement) {
    const kind = wordsSet(set)?.target;
    if (kind === TRACK_TARGET.macro) return host.lane();
    const at = host.selected();
    if (at === null) return null;
    return kind === TRACK_TARGET.transition ? transitionOf(arrangement, at) : at;
  }

  /**
   * Asks the model to read the area's words into `set`, then fills the timeline unsaved and says
   * what changed, with Keep and Undo.
   * @param {WordsArea} area
   * @param {string} set
   */
  async function ask(area, set) {
    if (pending !== null) throw new Error("Keep or undo the last words first.");
    const arrangement = host.draft();
    const vibeId = host.vibeId();
    const named = wordsSet(set);
    if (!named?.apply) throw new Error(`the field set ${set} isn't a track's`);
    if (arrangement === null || vibeId === null) throw new Error("The track isn't loaded yet.");
    const target = targetOf(set, arrangement);
    if (target === null) throw new Error("Choose a section first.");
    const words = area.input.value.trim();
    if (words.length === 0) throw new Error(WORDS_SAY.empty);
    const sent = JSON.stringify(arrangement);
    try {
      const done = await runJob(host.status, {
        path: `${VIBES_PATH}/${vibeId}/words`,
        body: { set, words, trackId: host.trackId, arrangement, target },
        controls,
        boxes: area.job,
        started: WORDS_SAY.reading,
      });
      if (done === null) return;
      if (done.refused !== null) {
        host.status.say(
          "That answer was for another words request, so the timeline is left as it was.",
        );
        return;
      }
      const now = host.draft();
      if (now === null || JSON.stringify(now) !== sent) {
        host.status.say(
          "The timeline changed while the model read your words, so its answer wasn't filled in. Ask again.",
        );
        return;
      }
      /** @type {{ changes: Record<string, unknown>, said: string }} */
      const { changes, said } = done.result;
      const context = { arrangement, target };
      const edit = named.apply(context, changes);
      const result = host.checked(edit.arrangement);
      if (!result.ok) {
        const list = result.errors.map(({ path, message }) => `${path}: ${message}`).join("; ");
        host.status.say(
          `The model's answer would leave the timeline with problems, so nothing was filled in: ${list}.`,
        );
        return;
      }
      const lines = trackChangeLines(set, arrangement, target, edit);
      if (lines.length === 0) {
        host.status.say(
          `The model read your words as: “${said}” Nothing changes: the timeline is already so.`,
        );
        return;
      }
      pending = { area, before: arrangement, after: edit.arrangement };
      host.edit(edit.arrangement);
      show(area, said, lines);
      host.status.say(WORDS_SAY.filled);
    } finally {
      host.draw();
    }
  }

  /**
   * Shows an answer's box in its area.
   * @param {WordsArea} area
   * @param {string} said
   * @param {readonly string[]} lines
   */
  function show(area, said, lines) {
    const box = cloneTemplate("words-answer", {
      said: HTMLElement,
      changes: HTMLUListElement,
      keep: HTMLButtonElement,
      undo: HTMLButtonElement,
    });
    box.said.textContent = `The model read your words as: “${said}”`;
    box.changes.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.className = "item";
        item.textContent = line;
        return item;
      }),
    );
    box.keep.onclick = () => keep();
    box.undo.onclick = () => undo();
    area.answer.replaceChildren(box.root);
  }

  /** Keeps the answer on the timeline, still unsaved. */
  function keep() {
    if (pending === null) return;
    const { area } = pending;
    pending = null;
    close(area);
    area.input.value = "";
    host.status.say("Kept on the timeline, unsaved. Save to keep it as a new version.");
    host.draw();
  }

  /** Puts the timeline back as it was before the answer. Nothing was saved. */
  function undo() {
    if (pending === null) return;
    const { area, before } = pending;
    pending = null;
    close(area);
    host.edit(before);
    host.status.say(WORDS_SAY.undone);
  }

  section.button.onclick = () => host.status.run(() => ask(section, parts.sectionWordsSet.value));
  lane.button.onclick = () => host.status.run(() => ask(lane, LANE_SET));

  /**
   * Turns a words button on, or off with why as its title.
   * @param {WordsArea} area
   * @param {string | null} why
   */
  function offWhen(area, why) {
    if (controls.some((control) => control.held())) return;
    area.button.disabled = why !== null;
    area.button.title = why ?? area.idle;
  }

  return {
    /**
     * Draws the select and turns the buttons on or off.
     * @param {boolean} valid whether the timeline has no errors
     */
    draw(valid) {
      const arrangement = host.draft();
      const at = host.selected();
      const chosen = parts.sectionWordsSet.value;
      const offered = SECTION_SETS.filter(
        (set) =>
          wordsSet(set)?.target !== TRACK_TARGET.transition ||
          (arrangement !== null && at !== null && transitionOf(arrangement, at) !== null),
      );
      parts.sectionWordsSet.replaceChildren(
        ...offered.map((set) => new Option(String(wordsSet(set)?.label), set)),
      );
      if (offered.some((set) => set === chosen)) parts.sectionWordsSet.value = chosen;
      const why =
        pending !== null
          ? "Turned off until you keep or undo the last words."
          : valid
            ? null
            : FIX_FIRST;
      offWhen(section, why ?? (at === null ? NO_SECTION : null));
      offWhen(
        lane,
        why ?? (arrangement?.sections.length ? null : "Turned off: the track has no sections yet."),
      );
    },
    /**
     * Hears each edit of the timeline: one other than the answer's own keeps the answer.
     * @param {Arrangement} next
     */
    edited(next) {
      if (pending === null || next === pending.after) return;
      const { area } = pending;
      pending = null;
      close(area);
      host.status.say("Kept the words' change, with your edit on top. Save to keep both.");
    },
    /** Closes an open answer as kept, when another version is opened or saved. */
    clear() {
      if (pending === null) return;
      close(pending.area);
      pending = null;
    },
  };
}

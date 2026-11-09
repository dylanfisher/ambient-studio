// The track page's words (decision 0087): the chosen section's Change it field, read into its
// length or its transition, and the chosen lane's, each through the words route as one
// owner-started job in the words lane. The page sends the timeline as it is and names the part;
// the answer is applied with the set's own `apply`, checked by the arrangement validator, and
// fills the timeline unsaved with Keep and Undo, as a session card's does (0085). One answer is
// open at a time; an edit of the timeline while one is open keeps it. `wordsController` holds
// that behavior with no DOM, so it is tested with a fake host; `trackWords` gives it the page.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { JobControl } from "./job-control.js" */
import { laneRoom, TRACK_TARGET } from "../domain/track-words.js";
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

/** The two places the page asks in words. */
const AREA = Object.freeze({ section: "section", lane: "lane" });

/** @typedef {(typeof AREA)[keyof typeof AREA]} Area */

/**
 * A words field and its button, as the controller reads and writes them.
 * @typedef {{ input: { value: string }, button: { disabled: boolean, title: string,
 *   onclick: ((event?: any) => unknown) | null } }} AreaParts
 */

/**
 * What the controller needs of the page.
 * @typedef {object} WordsHost
 * @property {{ run: (action: () => unknown) => unknown, say: (text: string) => void }} status
 * @property {number} trackId
 * @property {() => number | null} vibeId null until the track is read
 * @property {() => Arrangement | null} draft the timeline as the owner has it now
 * @property {() => number | null} selected the chosen section
 * @property {() => MacroName} lane the chosen lane
 * @property {(next: Arrangement) => void} edit puts a new arrangement on the timeline
 * @property {(arrangement: Arrangement) => { ok: true } | { ok: false, errors: ValidationError[] }} checked
 *   the page's arrangement validator
 * @property {() => void} draw draws the page again
 */

/**
 * What the controller does on the page.
 * @typedef {object} WordsIo
 * @property {(area: Area, body: Record<string, unknown>, controls: readonly JobControl[]) =>
 *   Promise<{ result: any, refused: string | null } | null>} run runs the words job
 * @property {(area: Area, said: string, lines: readonly string[],
 *   actions: { keep: () => void, undo: () => void }) => void} show shows an answer's box
 * @property {(area: Area) => void} close takes it away
 * @property {(choices: readonly { value: string, label: string }[]) => void} options fills the
 *   section's select
 */

/**
 * The words fields' behavior, with no DOM.
 * @param {WordsHost} host
 * @param {{ section: AreaParts, lane: AreaParts, select: { value: string } }} parts
 * @param {WordsIo} io
 */
export function wordsController(host, parts, io) {
  const idle = { section: parts.section.button.title, lane: parts.lane.button.title };
  const controls = [jobControl(parts.section.button), jobControl(parts.lane.button)];
  /** @type {{ area: Area, before: Arrangement, after: Arrangement } | null} */
  let pending = null;
  /** The select's choices as last filled, so a draw changes it only when they change. */
  let offeredKey = "";

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
   * @param {Area} area
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
    const words = parts[area].input.value.trim();
    if (words.length === 0) throw new Error(WORDS_SAY.empty);
    const sent = JSON.stringify(arrangement);
    try {
      const done = await io.run(
        area,
        { set, words, trackId: host.trackId, arrangement, target },
        controls,
      );
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
      const edit = named.apply({ arrangement, target }, changes);
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
      io.show(area, said, lines, { keep, undo });
      host.status.say(WORDS_SAY.filled);
    } finally {
      host.draw();
    }
  }

  /** Keeps the answer on the timeline, still unsaved. */
  function keep() {
    if (pending === null) return;
    const { area } = pending;
    pending = null;
    io.close(area);
    parts[area].input.value = "";
    host.status.say("Kept on the timeline, unsaved. Save to keep it as a new version.");
    host.draw();
  }

  /** Puts the timeline back as it was before the answer. Nothing was saved. */
  function undo() {
    if (pending === null) return;
    const { area, before } = pending;
    pending = null;
    io.close(area);
    host.edit(before);
    host.status.say(WORDS_SAY.undone);
  }

  parts.section.button.onclick = () => host.status.run(() => ask(AREA.section, parts.select.value));
  parts.lane.button.onclick = () => host.status.run(() => ask(AREA.lane, LANE_SET));

  /**
   * Turns a words button on, or off with why as its title.
   * @param {Area} area
   * @param {string | null} why
   */
  function offWhen(area, why) {
    if (controls.some((control) => control.held())) return;
    parts[area].button.disabled = why !== null;
    parts[area].button.title = why ?? idle[area];
  }

  return {
    /**
     * Fills the select when its choices change, and turns the buttons on or off.
     * @param {boolean} valid whether the timeline has no errors
     */
    draw(valid) {
      const arrangement = host.draft();
      const at = host.selected();
      const offered = SECTION_SETS.filter(
        (set) =>
          wordsSet(set)?.target !== TRACK_TARGET.transition ||
          (arrangement !== null && at !== null && transitionOf(arrangement, at) !== null),
      );
      // A draw runs on every edit, a drag's included; filling the select each time would close
      // it while it is open.
      const key = offered.join(" ");
      if (key !== offeredKey) {
        const chosen = parts.select.value;
        offeredKey = key;
        io.options(offered.map((set) => ({ value: set, label: String(wordsSet(set)?.label) })));
        if (offered.includes(chosen)) parts.select.value = chosen;
      }
      const why =
        pending !== null
          ? "Turned off until you keep or undo the last words."
          : valid
            ? null
            : FIX_FIRST;
      offWhen(AREA.section, why ?? (at === null ? NO_SECTION : null));
      const full =
        arrangement !== null && valid ? laneRoom({ arrangement, target: host.lane() }) : null;
      offWhen(
        AREA.lane,
        why ??
          (arrangement?.sections.length
            ? full && `Turned off: ${full}.`
            : "Turned off: the track has no sections yet."),
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
      io.close(area);
      host.status.say("Kept the words' change, with your edit on top. Save to keep both.");
    },
    /** Closes an open answer as kept, when another version is opened or saved. */
    clear() {
      if (pending === null) return;
      io.close(pending.area);
      pending = null;
    },
  };
}

/**
 * Mounts the words fields on the track page.
 * @param {WordsHost} host
 */
export function trackWords(host) {
  const page = elementsById({
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
  const boxes = {
    section: { job: page.sectionWordsJob, answer: page.sectionWordsAnswer },
    lane: { job: page.laneWordsJob, answer: page.laneWordsAnswer },
  };
  const vibeId = host.vibeId;
  return wordsController(
    host,
    {
      section: { input: page.sectionWordsInput, button: page.sectionWords },
      lane: { input: page.laneWordsInput, button: page.laneWords },
      select: page.sectionWordsSet,
    },
    {
      run: (area, body, controls) =>
        runJob(/** @type {import("./status-line.js").StatusLine} */ (host.status), {
          path: `${VIBES_PATH}/${vibeId()}/words`,
          body,
          controls,
          boxes: boxes[area].job,
          started: WORDS_SAY.reading,
        }),
      show(area, said, lines, { keep, undo }) {
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
        box.keep.onclick = keep;
        box.undo.onclick = undo;
        boxes[area].answer.replaceChildren(box.root);
      },
      close: (area) => boxes[area].answer.replaceChildren(),
      options: (choices) =>
        page.sectionWordsSet.replaceChildren(
          ...choices.map(({ value, label }) => new Option(label, value)),
        ),
    },
  );
}

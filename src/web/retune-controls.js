// A session card's retune control (decision 0094), from the page's `retune-controls` template:
// a tuning, scale and key, set at first to the candidate's own, and Retune, which makes one
// child with them and no model request. Choosing another tuning offers the candidate's scale
// when the tuning has it, else every degree, and the key nearest the candidate's root.
/** @import { RetunePitch } from "../domain/retune.js" */
/** @import { StartJob } from "./steer-controls.js" */
import { rootHz, samePitch, suggestedPitch } from "../domain/retune.js";
import { isAbsolute } from "../engine/tuning.js";
import { getTuning, tuningIds } from "../engine/tuning-registry.js";
import { sessionPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { jobControl } from "./job-control.js";
import { NO_SESSION } from "./steer-controls.js";

/** Why the button is off while the choices are the candidate's own. */
const SAME_PITCH = "Choose another tuning, scale or key first: these are the candidate's own.";

/**
 * @typedef {object} RetuneControls
 * @property {HTMLElement} root
 * @property {(why: string | null) => void} off turns the button off with `why` as its title,
 *   or back on with null, unless its job is unfinished
 */

/**
 * @param {object} options
 * @param {number} options.candidateId the base
 * @param {RetunePitch} options.genome the base's pitch
 * @param {() => number | null} options.sessionId the session the child goes to, or null when
 *   there is none to send to
 * @param {StartJob} options.start
 * @param {(work: () => unknown) => Promise<void>} options.run runs a click, showing its error
 * @returns {RetuneControls}
 */
export function retuneControls({ candidateId, genome, sessionId, start, run }) {
  const parts = cloneTemplate("retune-controls", {
    tuning: HTMLSelectElement,
    scale: HTMLSelectElement,
    key: HTMLSelectElement,
    retune: HTMLButtonElement,
  });
  // The page's title for the button while it can be pressed.
  const ready = parts.retune.title;
  const control = jobControl(parts.retune);
  /** @type {string | null} why the page turned the button off, or null */
  let pageOff = null;

  parts.tuning.replaceChildren(
    ...tuningIds().map((id) => new Option(`${id}: ${getTuning(id).name}`, id)),
  );

  /** @param {RetunePitch} pitch */
  function show(pitch) {
    const tuning = getTuning(pitch.tuning);
    parts.tuning.value = pitch.tuning;
    parts.scale.replaceChildren(
      ...Object.keys(tuning.scales).map((name) => new Option(name, name)),
    );
    parts.scale.value = pitch.scale;
    parts.key.hidden = isAbsolute(tuning);
    parts.key.replaceChildren(
      ...(isAbsolute(tuning)
        ? []
        : tuning.degrees.map((_, key) => {
            const hz = rootHz({ tuning: pitch.tuning, scale: pitch.scale, key });
            return new Option(`key ${key}, ${hz.toFixed(1)} Hz`, String(key));
          })),
    );
    if (pitch.key !== undefined) parts.key.value = String(pitch.key);
    refresh();
  }

  /** @returns {RetunePitch} */
  function chosen() {
    const tuning = parts.tuning.value;
    const scale = parts.scale.value;
    if (isAbsolute(getTuning(tuning))) return { tuning, scale };
    return { tuning, scale, key: Number(parts.key.value) };
  }

  function refresh() {
    if (control.held()) return;
    const same = samePitch(genome, chosen());
    parts.retune.disabled = pageOff !== null || same;
    parts.retune.title = pageOff ?? (same ? SAME_PITCH : ready);
  }

  parts.tuning.onchange = () => show(suggestedPitch(genome, parts.tuning.value));
  parts.scale.onchange = refresh;
  parts.key.onchange = refresh;
  parts.retune.onclick = () =>
    run(() => {
      const id = sessionId();
      if (id === null) throw new Error(NO_SESSION);
      return start(control, `${sessionPath(id)}/retunes`, { candidateId, ...chosen() });
    });

  show(
    genome.key === undefined
      ? { tuning: genome.tuning, scale: genome.scale }
      : { tuning: genome.tuning, scale: genome.scale, key: genome.key },
  );
  return {
    root: parts.root,
    off(why) {
      pageOff = why;
      refresh();
    },
  };
}

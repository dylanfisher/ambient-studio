// The search-by-ear page's steering panel (decision 0075): a variation and a slider for each
// path the search moves, sent together by Use from the next pair, and a line of words the model
// reads as the sliders, in a words job beside the search followed in a box with Cancel (0092).
// It is built once the search
// names its paths, and leaves the owner's unsent changes alone as the search moves on.
/** @import { EarSteering, EarVariation } from "../domain/ear-settings.js" */
/** @import { EarState } from "./quick-ab-ear.js" */
/** @import { statusLine } from "./status-line.js" */
import { EAR_PHASE, EAR_VARIATION } from "../domain/ear-settings.js";
import { postJson, sessionPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { leanText, pathName, steeringText, VARIATION_LABEL } from "./ear-steering-text.js";
import { elementsById } from "./element-by-id.js";
import { jobControl } from "./job-control.js";
import { oneAtATime } from "./one-at-a-time.js";
import { OWN_KEYS } from "./quick-ab-keys.js";
import { runJob } from "./run-job.js";

/**
 * @param {number} sessionId
 * @param {ReturnType<typeof statusLine>} status the page's status line
 * @returns {{ show: (ear: EarState | null) => void }}
 */
export function earSteeringPanel(sessionId, status) {
  const page = elementsById({
    earSteering: HTMLElement,
    earVariation: HTMLSelectElement,
    earShifts: HTMLElement,
    earSteer: HTMLButtonElement,
    earUnshift: HTMLButtonElement,
    earSteerLine: HTMLElement,
    earShiftWords: HTMLInputElement,
    earShiftRead: HTMLButtonElement,
    earShiftBox: HTMLElement,
  });
  const readControl = jobControl(page.earShiftRead);
  page.earVariation.replaceChildren(
    ...Object.keys(EAR_VARIATION).map((variation) => {
      const option = document.createElement("option");
      option.value = variation;
      option.textContent = VARIATION_LABEL[/** @type {EarVariation} */ (variation)];
      return option;
    }),
  );
  /** @type {Map<string, { input: HTMLInputElement, value: HTMLElement }>} each path's slider */
  const sliders = new Map();

  /** @param {Record<string, number>} shift */
  function setSliders(shift) {
    for (const [path, { input, value }] of sliders) {
      input.value = String(shift[path] ?? 0);
      value.textContent = leanText(path, Number(input.value));
    }
  }

  /** @param {EarSteering} steering */
  function fill({ variation, shift }) {
    page.earVariation.value = variation;
    setSliders(shift);
  }

  /** @param {readonly string[]} paths */
  function build(paths) {
    page.earShifts.replaceChildren(
      ...paths.map((path) => {
        const parts = cloneTemplate("shift-slider", {
          name: HTMLElement,
          input: HTMLInputElement,
          value: HTMLElement,
        });
        parts.name.textContent = pathName(path);
        parts.input.setAttribute("aria-label", `Lean toward less or more ${pathName(path)}`);
        // The page's keys play a side on the arrows; on a slider they move the slider alone.
        parts.input.setAttribute(OWN_KEYS, "");
        parts.input.oninput = () => {
          parts.value.textContent = leanText(path, Number(parts.input.value));
        };
        sliders.set(path, { input: parts.input, value: parts.value });
        return parts.root;
      }),
    );
  }

  const send = oneAtATime(async () => {
    const shift = Object.fromEntries(
      [...sliders].map(([path, { input }]) => [path, Number(input.value)]),
    );
    /** @type {EarState} */
    const state = await postJson(`${sessionPath(sessionId)}/ear-search/steering`, {
      variation: page.earVariation.value,
      shift,
    });
    fill(state.steering);
    page.earSteerLine.textContent = `From the next pair: ${steeringText(state.steering)}`;
    status.say("The next pair is drawn the new way.");
  });
  const readWords = oneAtATime(async () => {
    const words = page.earShiftWords.value.trim();
    if (words.length === 0)
      throw new Error("Type a shift first, such as darker and more spacious.");
    page.earSteerLine.textContent = "Asking the model to read your words…";
    const unread = "The words weren't read; the sliders are as they were.";
    /** @type {Awaited<ReturnType<typeof runJob>>} */
    let finished;
    try {
      finished = await runJob(status, {
        path: `${sessionPath(sessionId)}/ear-search/shift-words`,
        body: { words },
        controls: [readControl],
        boxes: page.earShiftBox,
        started: "The model is reading your words beside the search.",
      });
    } catch (error) {
      page.earSteerLine.textContent = unread;
      throw error;
    }
    if (finished === null) {
      page.earSteerLine.textContent = `${unread} Describe it again, or set the sliders by hand.`;
      return;
    }
    if (finished.refused) {
      page.earSteerLine.textContent = `${unread} Ask again once that job has finished.`;
      return;
    }
    /** @type {{ shift: Record<string, number> }} */
    const { shift } = finished.result;
    setSliders(shift);
    const leaning = steeringText({
      variation: /** @type {EarVariation} */ (page.earVariation.value),
      shift,
    });
    page.earSteerLine.textContent = `The model set the sliders: ${leaning} Press Use from the next pair to send them.`;
    status.say("The sliders are set from your words; the search isn't told yet.");
  });
  page.earSteer.onclick = () => status.run(send);
  page.earShiftRead.onclick = () => status.run(readWords);
  page.earUnshift.onclick = () => setSliders({});

  return {
    show(ear) {
      page.earSteering.hidden = ear === null || ear.paths.length === 0;
      if (ear === null || ear.paths.length === 0) return;
      if (sliders.size === 0) {
        build(ear.paths);
        fill(ear.steering);
        page.earSteerLine.textContent = `Now: ${steeringText(ear.steering)}`;
      }
      const ended = ear.phase === EAR_PHASE.finished || ear.stopped;
      const controls = [page.earVariation, page.earSteer, page.earUnshift, page.earShiftWords];
      for (const control of controls) {
        control.disabled = ended;
      }
      // Held off while its words job runs, whatever the search is doing.
      page.earShiftRead.disabled = ended || readControl.held();
      for (const { input } of sliders.values()) input.disabled = ended;
    },
  };
}

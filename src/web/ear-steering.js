// The search-by-ear page's steering panel (decision 0075): a variation and a slider for each
// path the search moves, sent together by Use from the next pair. It is built once the search
// names its paths, and leaves the owner's unsent changes alone as the search moves on.
/** @import { EarSteering, EarVariation } from "../domain/ear-settings.js" */
/** @import { EarState } from "./quick-ab-ear.js" */
/** @import { statusLine } from "./status-line.js" */
import { EAR_PHASE, EAR_VARIATION } from "../domain/ear-settings.js";
import { postJson, sessionPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { leanText, pathName, steeringText, VARIATION_LABEL } from "./ear-steering-text.js";
import { elementsById } from "./element-by-id.js";
import { oneAtATime } from "./one-at-a-time.js";
import { OWN_KEYS } from "./quick-ab-keys.js";

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
  });
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

  /** @param {EarSteering} steering */
  function fill({ variation, shift }) {
    page.earVariation.value = variation;
    for (const [path, { input, value }] of sliders) {
      input.value = String(shift[path] ?? 0);
      value.textContent = leanText(path, Number(input.value));
    }
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
  page.earSteer.onclick = () => status.run(send);
  page.earUnshift.onclick = () => {
    for (const [path, { input, value }] of sliders) {
      input.value = "0";
      value.textContent = leanText(path, 0);
    }
  };

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
      for (const control of [page.earVariation, page.earSteer, page.earUnshift]) {
        control.disabled = ended;
      }
      for (const { input } of sliders.values()) input.disabled = ended;
    },
  };
}

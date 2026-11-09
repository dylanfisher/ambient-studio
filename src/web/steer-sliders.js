// A session card's sliders (decision 0056), from the page's `steer-sliders` template: one per
// direction of the brief, from its near end to its far end, starting at the card's position, a
// "Toward this region" box per attached region, a points field and Steer from here, which asks
// first with the cost. Steer sends only the sliders the owner moved and the regions ticked. The
// page sends the request and follows the job; this builds the request and shows the controls.
/** @import { StepSeconds } from "../domain/search-cost.js" */
/** @import { StartJob } from "./steer-controls.js" */

import { steerCostText } from "../domain/search-cost.js";
import { DEFAULT_STEER_BUDGET, MAX_SEARCH_BUDGET } from "../domain/search-settings.js";
import { getJson, SEARCH_ESTIMATE_PATH, sessionPath } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { directionText, SLIDER_STEP, sliderStart, slidersUnsent } from "./direction-text.js";
import { jobControl } from "./job-control.js";
import { NO_SESSION } from "./steer-controls.js";

/**
 * The brief's directions and regions as the steering route gives them.
 * @typedef {object} SteeringView
 * @property {string | null} reason why nothing can be placed, as no sound analysis
 * @property {{ id: number, near: string | null, far: string, reason: string | null,
 *   positions: Record<number, number> }[]} directions
 * @property {{ id: number, label: string, reason: string | null,
 *   positions: Record<number, number> }[]} regions
 */

/**
 * @typedef {object} SteerSliders
 * @property {HTMLElement} root
 * @property {(steering: SteeringView, renderId: number | null) => void} show sets the sliders
 *   and regions; a slider the owner moved keeps its setting
 * @property {() => boolean} unsent whether a slider was moved or a region ticked and not sent
 * @property {(why: string | null) => void} off turns Steer off with `why` as its title, or back
 *   on with null, unless its job is unfinished
 * @property {() => Map<number, number>} settings each direction's slider setting now, by id
 * @property {(settings: ReadonlyMap<number, number>) => SliderSnapshot} fill sets the named
 *   sliders as moved, as a words answer does (0085), and returns what they held before
 * @property {(snapshot: SliderSnapshot) => void} restore puts back what `fill` returned
 */

/** @typedef {Map<number, { value: string, moved: boolean }>} SliderSnapshot */

/**
 * @param {object} options
 * @param {number} options.candidateId the base
 * @param {() => number | null} options.sessionId
 * @param {StartJob} options.start
 * @param {(work: () => unknown) => Promise<void>} options.run runs a click, showing its error
 * @returns {SteerSliders}
 */
export function steerSliders({ candidateId, sessionId, start, run }) {
  const parts = cloneTemplate("steer-sliders", {
    sliders: HTMLElement,
    regions: HTMLElement,
    budget: HTMLInputElement,
    steer: HTMLButtonElement,
  });
  parts.budget.min = "1";
  parts.budget.max = String(MAX_SEARCH_BUDGET);
  parts.budget.value = String(DEFAULT_STEER_BUDGET);
  const control = jobControl(parts.steer);
  const idle = parts.steer.title;
  /**
   * Each direction's slider, by attachment id, with the title it has when on.
   * @type {Map<number, { input: HTMLInputElement, idle: string, position: HTMLElement, moved: boolean }>}
   */
  const sliders = new Map();
  /** @type {Map<number, { input: HTMLInputElement, idle: string }>} each region's box */
  const boxes = new Map();
  /** The ids shown, so a reread with the same directions and regions keeps the owner's moves. */
  let shownKey = "";
  /** Why Steer is off from the page, or null. */
  let pageWhy = /** @type {string | null} */ (null);
  /** Why Steer is off from the steering, or null. */
  let steeringWhy = /** @type {string | null} */ (null);

  const showButton = () => {
    if (control.held()) return;
    const why = pageWhy ?? steeringWhy;
    parts.steer.disabled = why !== null;
    parts.steer.title = why ?? idle;
  };

  /** @param {SteeringView} steering @param {number | null} renderId */
  function show(steering, renderId) {
    const key = JSON.stringify([
      steering.directions.map(({ id }) => id),
      steering.regions.map(({ id }) => id),
    ]);
    if (key !== shownKey) {
      shownKey = key;
      sliders.clear();
      boxes.clear();
      parts.sliders.replaceChildren(
        ...steering.directions.map((direction) => {
          const slider = cloneTemplate("steer-slider", {
            name: HTMLElement,
            near: HTMLElement,
            far: HTMLElement,
            input: HTMLInputElement,
            position: HTMLElement,
          });
          slider.name.textContent = directionText(direction);
          slider.near.textContent = direction.near ?? "this brief";
          slider.far.textContent = direction.far;
          slider.input.step = String(SLIDER_STEP);
          const entry = {
            input: slider.input,
            idle: slider.input.title,
            position: slider.position,
            moved: false,
          };
          slider.input.addEventListener("input", () => {
            entry.moved = true;
          });
          sliders.set(direction.id, entry);
          return slider.root;
        }),
      );
      parts.regions.replaceChildren(
        ...steering.regions.map((region) => {
          const box = cloneTemplate("steer-region", { input: HTMLInputElement, name: HTMLElement });
          box.name.textContent = region.label;
          boxes.set(region.id, { input: box.input, idle: box.input.title });
          return box.root;
        }),
      );
    }
    for (const direction of steering.directions) {
      const entry = /** @type {NonNullable<ReturnType<typeof sliders.get>>} */ (
        sliders.get(direction.id)
      );
      const position = renderId === null ? undefined : direction.positions[renderId];
      const why = steering.reason ?? direction.reason;
      entry.input.disabled = why !== null;
      entry.input.title = why ?? entry.idle;
      if (!entry.moved) entry.input.value = String(sliderStart(position));
      entry.position.textContent =
        why !== null
          ? `Can't be placed yet: ${why}.`
          : position === undefined
            ? "This candidate isn't placed yet; it is placed once its sound is analyzed."
            : `This candidate sits at ${position.toFixed(2)}.`;
    }
    for (const region of steering.regions) {
      const { input, idle: on } = /** @type {NonNullable<ReturnType<typeof boxes.get>>} */ (
        boxes.get(region.id)
      );
      const why = steering.reason ?? region.reason;
      input.disabled = why !== null;
      if (why !== null) input.checked = false;
      input.title = why ?? on;
    }
    parts.root.hidden = steering.directions.length === 0 && steering.regions.length === 0;
    steeringWhy = steering.reason;
    showButton();
  }

  parts.steer.onclick = () =>
    run(async () => {
      const id = sessionId();
      if (id === null) throw new Error(NO_SESSION);
      const budget = Number(parts.budget.value);
      if (!Number.isInteger(budget) || budget < 1 || budget > MAX_SEARCH_BUDGET) {
        throw new Error(
          `The steer's points must be a whole number from 1 to ${MAX_SEARCH_BUDGET}.`,
        );
      }
      const directions = [...sliders]
        .filter(([, entry]) => entry.moved && !entry.input.disabled)
        .map(([direction, entry]) => ({ id: direction, setting: Number(entry.input.value) }));
      const regions = [...boxes].filter(([, box]) => box.input.checked).map(([region]) => region);
      if (directions.length === 0 && regions.length === 0) {
        throw new Error("Move a slider or tick a region to steer toward first.");
      }
      /** @type {{ seconds: StepSeconds, measured: boolean }} */
      const { seconds, measured } = await getJson(SEARCH_ESTIMATE_PATH);
      if (!confirm(steerCostText(budget, seconds, { measured }))) return;
      await start(control, `${sessionPath(id)}/steers`, {
        candidateId,
        budget,
        directions,
        regions,
      });
      for (const entry of sliders.values()) entry.moved = false;
      for (const box of boxes.values()) box.input.checked = false;
    });

  return {
    root: parts.root,
    show,
    settings: () => new Map([...sliders].map(([id, { input }]) => [id, Number(input.value)])),
    fill(settings) {
      /** @type {SliderSnapshot} */
      const snapshot = new Map();
      for (const [id, setting] of settings) {
        const entry = sliders.get(id);
        if (!entry) throw new Error(`the card has no slider for direction ${id}`);
        snapshot.set(id, { value: entry.input.value, moved: entry.moved });
        entry.input.value = String(setting);
        entry.moved = true;
      }
      return snapshot;
    },
    restore(snapshot) {
      for (const [id, { value, moved }] of snapshot) {
        const entry = sliders.get(id);
        if (!entry) continue;
        entry.input.value = value;
        entry.moved = moved;
      }
    },
    unsent: () =>
      slidersUnsent(
        [...sliders.values()].map(({ moved, input }) => ({ moved, disabled: input.disabled })),
        [...boxes.values()].map(({ input }) => input),
      ),
    off(why) {
      pageWhy = why;
      showButton();
    },
  };
}

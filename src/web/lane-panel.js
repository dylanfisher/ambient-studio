// The macro lanes under the timeline (decision 0065): one row per macro, its line and points
// drawn across the track's length, edited by the chosen point's fields, by dragging a point, or
// by the keys shown on each button (`lane-keys.js`). The edits are `lane-edits.js`'s and go
// through the timeline page's own `edit`, so the lanes are checked and saved with the rest of
// the arrangement. A drag moves the point on the page and makes its one edit when let go.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { LanePoint } from "../domain/lane-schema.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { StatusLine } from "./status-line.js" */
/** @import { LaneAction } from "./lane-keys.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { LANE_OFFSET } from "../domain/lane-schema.js";
import { MACROS } from "../engine/genome-schema.js";
import { elementsById } from "./element-by-id.js";
import { keyButtons } from "./key-buttons.js";
import {
  addPoint,
  LANE_OFFSET_STEP,
  LANE_TIME_STEP,
  lanePoints,
  movePoint,
  nextPointCurve,
  removePoint,
  setPoint,
} from "./lane-edits.js";
import { bindLaneKeys, LANE_KEYS } from "./lane-keys.js";
import { dragOffset, laneLayout, laneText, offsetTop, pointText } from "./lane-layout.js";
import { dragSeconds } from "./timeline-layout.js";

const SVG = "http://www.w3.org/2000/svg";
const MACRO_NAMES = /** @type {MacroName[]} */ (Object.keys(MACROS));

/**
 * Mounts the lanes on the timeline page.
 * @param {object} page
 * @param {() => Arrangement | null} page.draft the timeline as the owner has it now
 * @param {(next: Arrangement) => void} page.edit puts a new arrangement on the timeline and draws
 * @param {StatusLine} page.status
 * @returns {{ draw: () => void }}
 */
export function lanePanel({ draft, edit, status }) {
  const parts = elementsById({
    lanes: HTMLElement,
    pointLine: HTMLElement,
    pointTimeInput: HTMLInputElement,
    pointOffsetInput: HTMLInputElement,
  });
  parts.pointOffsetInput.min = String(LANE_OFFSET.min);
  parts.pointOffsetInput.max = String(LANE_OFFSET.max);
  parts.pointOffsetInput.step = String(LANE_OFFSET_STEP);
  const buttons = keyButtons(LANE_KEYS);
  for (const [name, words] of /** @type {[LaneAction, string][]} */ ([
    ["pointEarlier", `${LANE_TIME_STEP} s earlier`],
    ["pointLater", `${LANE_TIME_STEP} s later`],
    ["offsetLower", `${LANE_OFFSET_STEP} lower`],
    ["offsetHigher", `${LANE_OFFSET_STEP} higher`],
  ])) {
    buttons[name].firstChild?.replaceWith(document.createTextNode(words));
  }

  /** @type {MacroName} the lane the keys act on */
  let macro = /** @type {MacroName} */ (MACRO_NAMES[0]);
  /** @type {number | null} its point the keys act on */
  let chosen = null;

  /** The track's seconds, or 0 while the timeline holds values that aren't numbers. */
  const lengthOf = (/** @type {Arrangement} */ arrangement) => {
    const length = arrangementLength(arrangement);
    return Number.isFinite(length) ? length : 0;
  };

  /**
   * Runs `change` on the chosen point, when there is one.
   * @param {(arrangement: Arrangement, index: number) => Arrangement} change
   */
  const onPoint = (change) => {
    const arrangement = draft();
    if (arrangement === null || chosen === null) return;
    edit(change(arrangement, chosen));
  };

  /**
   * Chooses a lane, and its first point when it has one.
   * @param {MacroName} name
   */
  const chooseLane = (name) => {
    macro = name;
    const arrangement = draft();
    chosen = arrangement && lanePoints(arrangement, name).length > 0 ? 0 : null;
    draw();
  };

  /** @param {-1 | 1} step */
  const stepLane = (step) => {
    const at = MACRO_NAMES.indexOf(macro) + step;
    const name = MACRO_NAMES[at];
    if (name) chooseLane(name);
  };

  /** @param {-1 | 1} step */
  const stepPoint = (step) => {
    const arrangement = draft();
    if (arrangement === null || chosen === null) return;
    const at = chosen + step;
    if (at >= 0 && at < lanePoints(arrangement, macro).length) chosen = at;
    draw();
  };

  /**
   * A field's number, or a throw naming the field.
   * @param {HTMLInputElement} input
   * @param {string} name
   */
  const fieldNumber = (input, name) => {
    const value = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(value)) {
      throw new Error(`${name} must be a number.`);
    }
    return value;
  };
  parts.pointTimeInput.onchange = () =>
    status.run(() => {
      const time = fieldNumber(parts.pointTimeInput, "The point's time");
      onPoint((arrangement, index) => setPoint(arrangement, macro, index, { time }));
    });
  parts.pointOffsetInput.onchange = () =>
    status.run(() => {
      const offset = fieldNumber(parts.pointOffsetInput, "The point's offset");
      onPoint((arrangement, index) => setPoint(arrangement, macro, index, { offset }));
    });

  /** Each action, run by its button and its key. */
  const actions = /** @type {Record<LaneAction, () => void>} */ ({
    lanePrevious: () => stepLane(-1),
    laneNext: () => stepLane(1),
    pointPrevious: () => stepPoint(-1),
    pointNext: () => stepPoint(1),
    pointEarlier: () =>
      onPoint((a, i) => movePoint(a, macro, i, { seconds: -LANE_TIME_STEP, offset: 0 })),
    pointLater: () =>
      onPoint((a, i) => movePoint(a, macro, i, { seconds: LANE_TIME_STEP, offset: 0 })),
    offsetLower: () =>
      onPoint((a, i) => movePoint(a, macro, i, { seconds: 0, offset: -LANE_OFFSET_STEP })),
    offsetHigher: () =>
      onPoint((a, i) => movePoint(a, macro, i, { seconds: 0, offset: LANE_OFFSET_STEP })),
    pointCurve: () => onPoint((a, i) => nextPointCurve(a, macro, i)),
    addPoint: () => {
      const arrangement = draft();
      if (arrangement === null) return;
      const made = addPoint(arrangement, macro, chosen, lengthOf(arrangement));
      if (made.arrangement === arrangement) {
        status.say(
          "No room for a point after the chosen one: it is at the track's end, or the next point is a tenth of a second away.",
        );
        return;
      }
      chosen = made.index;
      edit(made.arrangement);
    },
    removePoint: () => {
      const arrangement = draft();
      if (arrangement === null || chosen === null) return;
      const removed = removePoint(arrangement, macro, chosen);
      chosen = removed.index;
      edit(removed.arrangement);
    },
  });
  for (const [name, action] of Object.entries(actions)) {
    buttons[/** @type {LaneAction} */ (name)].onclick = () => status.run(action);
  }
  bindLaneKeys(document, actions, () => document.activeElement);

  /** Draws every lane and the chosen point's fields from the timeline. */
  function draw() {
    const arrangement = draft();
    if (arrangement === null) return;
    const length = lengthOf(arrangement);
    const points = lanePoints(arrangement, macro);
    if (chosen !== null && chosen >= points.length) chosen = points.length - 1;
    if (chosen === null && points.length > 0) chosen = 0;
    if (points.length === 0) chosen = null;
    const hadFocus = parts.lanes.contains(document.activeElement);
    const rows = MACRO_NAMES.map((name) => laneRow(name, lanePoints(arrangement, name), length));
    parts.lanes.replaceChildren(...rows.map(({ row }) => row));
    if (hadFocus) rows[MACRO_NAMES.indexOf(macro)]?.focus.focus();

    buttons.lanePrevious.disabled = macro === MACRO_NAMES[0];
    buttons.laneNext.disabled = macro === MACRO_NAMES.at(-1);
    for (const name of /** @type {LaneAction[]} */ ([
      "pointPrevious",
      "pointNext",
      "pointEarlier",
      "pointLater",
      "offsetLower",
      "offsetHigher",
      "pointCurve",
      "removePoint",
    ])) {
      buttons[name].disabled = chosen === null;
    }
    if (chosen === null) {
      parts.pointLine.textContent = `${laneText(macro, points)} Add a point to change it.`;
      parts.pointTimeInput.disabled = true;
      parts.pointOffsetInput.disabled = true;
      return;
    }
    buttons.pointPrevious.disabled = chosen === 0;
    buttons.pointNext.disabled = chosen === points.length - 1;
    buttons.pointCurve.disabled = chosen === 0;
    parts.pointTimeInput.disabled = false;
    parts.pointOffsetInput.disabled = false;
    const [time, offset] = /** @type {LanePoint} */ (points[chosen]);
    fill(parts.pointTimeInput, time);
    fill(parts.pointOffsetInput, offset);
    parts.pointLine.textContent = pointText(macro, points, chosen);
  }

  /**
   * One lane's row: its name, which chooses it, and its strip with the line and the points.
   * @param {MacroName} name
   * @param {LanePoint[]} points
   * @param {number} length
   * @returns {{ row: HTMLElement, focus: HTMLElement }}
   */
  function laneRow(name, points, length) {
    const row = document.createElement("div");
    row.className = "lane";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "button outline small lane-name";
    label.textContent = name;
    label.title = `${laneText(name, points)} Click to choose this lane, which the point buttons and keys act on.`;
    label.setAttribute("aria-pressed", String(name === macro));
    label.onclick = () => chooseLane(name);
    const strip = document.createElement("div");
    strip.className = "lane-strip";
    const { dots, line } = laneLayout(points, length);
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const middle = document.createElementNS(SVG, "line");
    const zero = String(offsetTop(0));
    for (const [key, value] of /** @type {[string, string][]} */ ([
      ["x1", "0"],
      ["x2", "100"],
      ["y1", zero],
      ["y2", zero],
      ["class", "lane-zero"],
    ])) {
      middle.setAttribute(key, value);
    }
    const path = document.createElementNS(SVG, "polyline");
    path.setAttribute("points", line);
    path.setAttribute("class", "lane-line");
    svg.append(middle, path);
    const buttonsOf = dots.map((dot, index) =>
      pointButton(strip, name, points, index, dot, length),
    );
    strip.append(svg, ...buttonsOf);
    row.append(label, strip);
    const focus = (name === macro && chosen !== null && buttonsOf[chosen]) || label;
    return { row, focus };
  }

  /**
   * A point's button: a click chooses it; a drag moves it across in time and up or down in
   * offset, and makes its one edit when let go.
   * @param {HTMLElement} strip
   * @param {MacroName} name
   * @param {LanePoint[]} points
   * @param {number} index
   * @param {{ left: number, top: number }} dot
   * @param {number} length
   */
  function pointButton(strip, name, points, index, dot, length) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lane-point";
    button.style.left = `${dot.left}%`;
    button.style.top = `${dot.top}%`;
    button.title = `${pointText(name, points, index)} Click to choose it; drag it across to move it in time, or up and down to change its offset.`;
    button.setAttribute("aria-pressed", String(name === macro && index === chosen));
    const choose = () => {
      macro = name;
      chosen = index;
    };
    button.onclick = () => {
      choose();
      draw();
    };
    /** @type {{ id: number, x: number, y: number } | null} */
    let held = null;
    const moved = (/** @type {PointerEvent} */ event) =>
      held === null
        ? { seconds: 0, offset: 0 }
        : {
            seconds: dragSeconds(event.clientX - held.x, strip.clientWidth, length),
            offset: dragOffset(event.clientY - held.y, strip.clientHeight),
          };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      choose();
      button.setPointerCapture(event.pointerId);
      held = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    button.addEventListener("pointermove", (event) => {
      if (held === null || event.pointerId !== held.id) return;
      button.style.left = `calc(${dot.left}% + ${event.clientX - held.x}px)`;
      button.style.top = `calc(${dot.top}% + ${event.clientY - held.y}px)`;
    });
    button.addEventListener("pointerup", (event) => {
      if (held === null || event.pointerId !== held.id) return;
      const by = moved(event);
      held = null;
      const arrangement = draft();
      if (arrangement === null) return;
      if (by.seconds === 0 && by.offset === 0) draw();
      else edit(movePoint(arrangement, name, index, by));
    });
    button.addEventListener("pointercancel", () => {
      held = null;
      button.style.left = `${dot.left}%`;
      button.style.top = `${dot.top}%`;
    });
    return button;
  }

  return { draw };
}

/** Writes a number into a field unless the owner is typing in it. */
function fill(/** @type {HTMLInputElement} */ input, /** @type {number} */ value) {
  if (document.activeElement !== input) input.value = String(value);
}

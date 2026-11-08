// Draws the timeline (decision 0061) from `timelineLayout`: one button per section, placed and
// sized by its time on the track, on two alternating rows so a crossfade shows as the overlap
// of two blocks, with a handle on each edge to drag. A drag moves the block on the page as the
// pointer moves and makes its one edit when the pointer is let go. Every drag has a key and a
// button that does the same (`timeline-keys.js`), so the timeline works without one.
/** @import { Edge } from "./timeline-edits.js" */
/** @import { Span } from "./timeline-layout.js" */
import { EDGE } from "./timeline-edits.js";
import { dragSeconds } from "./timeline-layout.js";

/**
 * @typedef {object} TimelineBlock
 * @property {Span} span
 * @property {string} name
 * @property {string} times
 */

/**
 * @typedef {object} TimelineHandlers
 * @property {(index: number) => void} select
 * @property {(index: number, edge: Edge, seconds: number) => void} drag a let-go
 *   drag of one edge, in track seconds
 */

/** The edges a block can be dragged by. */
const EDGES = /** @type {Edge[]} */ (Object.values(EDGE));

/**
 * @param {HTMLElement} container
 * @param {{ length: number, blocks: TimelineBlock[], fades: Span[] }} drawn
 * @param {number | null} selected
 * @param {TimelineHandlers} on
 */
export function drawTimeline(container, { length, blocks, fades }, selected, on) {
  const hadFocus = container.contains(document.activeElement);
  const fadeMarks = fades.map(({ left, width }) => {
    const mark = document.createElement("div");
    mark.className = "timeline-fade";
    mark.style.left = `${left}%`;
    mark.style.width = `${width}%`;
    return mark;
  });
  const buttons = blocks.map(({ span, name, times }, index) => {
    const block = document.createElement("button");
    block.type = "button";
    block.className = `timeline-block ${index % 2 === 0 ? "upper" : "lower"}`;
    block.style.left = `${span.left}%`;
    block.style.width = `${span.width}%`;
    block.title = `Section ${index + 1}, ${name}, ${times}. Click to choose it; drag an edge to change where it starts or how long it plays.`;
    block.setAttribute("aria-pressed", String(index === selected));
    const label = document.createElement("span");
    label.className = "timeline-label";
    label.textContent = `${index + 1}. ${name}`;
    block.append(label);
    block.onclick = () => on.select(index);
    for (const edge of EDGES)
      block.append(
        edgeHandle(
          container,
          block,
          span,
          length,
          edge,
          () => on.select(index),
          (seconds) => on.drag(index, edge, seconds),
        ),
      );
    return block;
  });
  container.replaceChildren(...fadeMarks, ...buttons);
  if (hadFocus && selected !== null) buttons[selected]?.focus();
}

/**
 * A handle on one edge of a block. While it is dragged the block follows the pointer; on let
 * go `done` gets the seconds moved.
 * @param {HTMLElement} container
 * @param {HTMLElement} block
 * @param {Span} span
 * @param {number} length the track's seconds
 * @param {Edge} edge
 * @param {() => void} select
 * @param {(seconds: number) => void} done
 */
function edgeHandle(container, block, span, length, edge, select, done) {
  const handle = document.createElement("span");
  handle.className = `timeline-edge ${edge}`;
  handle.setAttribute("aria-hidden", "true");
  /** @type {{ id: number, x: number } | null} */
  let held = null;
  const moved = (/** @type {PointerEvent} */ event) =>
    held === null ? 0 : dragSeconds(event.clientX - held.x, container.clientWidth, length);
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    select();
    handle.setPointerCapture(event.pointerId);
    held = { id: event.pointerId, x: event.clientX };
  });
  handle.addEventListener("pointermove", (event) => {
    if (held === null || event.pointerId !== held.id) return;
    const share = (moved(event) / length) * 100;
    if (edge === EDGE.end) block.style.width = `${Math.max(0, span.width + share)}%`;
    else {
      block.style.left = `${span.left + share}%`;
      block.style.width = `${Math.max(0, span.width - share)}%`;
    }
  });
  handle.addEventListener("pointerup", (event) => {
    if (held === null || event.pointerId !== held.id) return;
    const seconds = moved(event);
    held = null;
    if (seconds !== 0) done(seconds);
  });
  handle.addEventListener("pointercancel", () => {
    held = null;
    block.style.left = `${span.left}%`;
    block.style.width = `${span.width}%`;
  });
  // A click on a handle is part of a drag, not a choice of the block.
  handle.addEventListener("click", (event) => event.stopPropagation());
  return handle;
}

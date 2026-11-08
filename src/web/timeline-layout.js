// The timeline's layout (decision 0061), with no DOM: each section a block placed and sized as
// a share of the track's length, each crossfade the overlap of two blocks, and the words a block
// shows. `timeline-view.js` draws it.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { clockTime } from "./excerpt-player.js";

/**
 * A span of the track: `start` and `end` in track seconds, `left` and `width` in percent of its
 * length.
 * @typedef {{ start: number, end: number, left: number, width: number }} Span
 */

/**
 * The sketch a block names, as the track route lists it.
 * @typedef {{ id: number, intent: string | null, duration: number }} BlockSketch
 */

/** Percents are rounded to this many places, so a layout compares equal across browsers. */
const PLACES = 1e6;

/**
 * @param {number} start
 * @param {number} end
 * @param {number} length
 * @returns {Span}
 */
function span(start, end, length) {
  const percent = (/** @type {number} */ seconds) =>
    Math.round((seconds / length) * 100 * PLACES) / PLACES;
  return { start, end, left: percent(start), width: percent(end - start) };
}

/**
 * @param {Arrangement} arrangement
 * @returns {{ length: number, blocks: Span[], fades: Span[] }}
 */
export function timelineLayout(arrangement) {
  const length = arrangementLength(arrangement);
  /** @type {Span[]} */
  const blocks = [];
  let start = 0;
  arrangement.sections.forEach(({ seconds }, i) => {
    blocks.push(span(start, start + seconds, length));
    start += seconds - (arrangement.transitions[i]?.seconds ?? 0);
  });
  const fades = arrangement.transitions.map(({ seconds }, i) => {
    const end = /** @type {Span} */ (blocks[i]).end;
    return span(end - seconds, end, length);
  });
  return { length, blocks, fades };
}

/**
 * The track seconds a drag of `pixels` across a timeline `width` pixels wide moves, to a tenth
 * of a second.
 * @param {number} pixels
 * @param {number} width
 * @param {number} length the track's, in seconds
 */
export function dragSeconds(pixels, width, length) {
  if (!(width > 0)) return 0;
  return Math.round((pixels / width) * length * 10) / 10;
}

/**
 * How many sections, in words.
 * @param {number} count
 */
export const sectionCount = (count) => `${count} ${count === 1 ? "section" : "sections"}`;

/**
 * A block's name and the part of its sketch it plays, with how far it is extended past the
 * sketch's end.
 * @param {Section} section
 * @param {BlockSketch | undefined} sketch undefined when the sketch is no longer listed
 * @returns {{ name: string, times: string }}
 */
export function blockText({ sketchId, offset, seconds }, sketch) {
  const end = offset + seconds;
  const range = `${clockTime(offset)} to ${clockTime(end)}`;
  if (!sketch)
    return { name: `Sketch ${sketchId}, no longer kept`, times: `${range}, ${seconds} s` };
  const past = end - sketch.duration;
  const extended = past > 0 ? `; extended by ${clockTime(past)} past its end` : "";
  return {
    name: sketch.intent ? `Sketch ${sketchId}: ${sketch.intent}` : `Sketch ${sketchId}`,
    times: `${range} of its ${clockTime(sketch.duration)}, ${seconds} s${extended}`,
  };
}

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

/** The most of a section's text its block shows, in characters, before it is cut at a word. */
const BLOCK_WORDS = 40;

/**
 * The span from `start` to `end` on a track `length` seconds long.
 * @param {number} start
 * @param {number} end
 * @param {number} length
 * @returns {Span}
 */
export function span(start, end, length) {
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
 * The start of a section's text on one line: all of it up to `BLOCK_WORDS` characters, else cut
 * at the last word that fits, or at `BLOCK_WORDS` when one word is longer, with an ellipsis.
 * @param {string} text
 */
function startOf(text) {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= BLOCK_WORDS) return line;
  const cut = line.slice(0, BLOCK_WORDS + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut.slice(0, BLOCK_WORDS)).trimEnd()}…`;
}

/**
 * A block's name, the part of its sketch it plays, with how far it is extended past the
 * sketch's end, and the start of its text, "" when it has none.
 * @param {Section} section
 * @param {BlockSketch | undefined} sketch undefined when the sketch is no longer listed
 * @returns {{ name: string, times: string, words: string }}
 */
export function blockText({ sketchId, offset, seconds, text }, sketch) {
  const end = offset + seconds;
  const range = `${clockTime(offset)} to ${clockTime(end)}`;
  const words = startOf(text);
  if (!sketch)
    return { name: `Sketch ${sketchId}, no longer kept`, times: `${range}, ${seconds} s`, words };
  const past = end - sketch.duration;
  const extended = past > 0 ? `; extended by ${clockTime(past)} past its end` : "";
  return {
    name: sketch.intent ? `Sketch ${sketchId}: ${sketch.intent}` : `Sketch ${sketchId}`,
    times: `${range} of its ${clockTime(sketch.duration)}, ${seconds} s${extended}`,
    words,
  };
}

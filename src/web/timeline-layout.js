// The timeline's layout (decision 0061), with no DOM: each section a block placed and sized as
// a share of the track's length, each crossfade the overlap of two blocks, and the words a block
// shows. `timeline-view.js` draws it.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
import { arrangementLength, sectionStarts } from "../domain/arrangement-length.js";
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
 * A section's place on the track in words (0087): how long it plays and where it starts, as
 * clock times.
 * @param {Arrangement} arrangement
 * @param {number} index the section's, from 0
 */
export function placeWords(arrangement, index) {
  const { seconds } = /** @type {Section} */ (arrangement.sections[index]);
  const start = /** @type {number} */ (sectionStarts(arrangement)[index]);
  return `Plays ${clockTime(seconds)}, from ${clockTime(start)} on the track.`;
}

/**
 * What a section plays, as "its …" says it: its sketch, its development, or its bridge (0079,
 * 0081), whose own timeline its offset is on.
 * @param {{ bridge: boolean }} [development] the one it plays, if any
 */
export const playedName = (development) =>
  development ? (development.bridge ? "its bridge" : "its development") : "its sketch";

/**
 * Where a section plays from, in words (0087): the start of what it plays or partway in, and
 * whether it runs past the end of that genome. The offset and seconds are behind the numbers
 * toggle.
 * @param {Section} section
 * @param {BlockSketch | undefined} sketch
 * @param {{ seconds: number, bridge: boolean }} [development]
 */
export function playsWords({ offset, seconds }, sketch, development) {
  const what = playedName(development);
  const from = offset === 0 ? "from the start" : "from partway in";
  const duration = development?.seconds ?? sketch?.duration;
  const past =
    duration !== undefined && offset + seconds > duration
      ? ", and runs past its end, which extends it"
      : "";
  return `It plays ${what} ${from}${past}.`;
}

/**
 * A block's name, the part of its sketch or its development it plays (0079), with how far it is
 * extended past that genome's end, and the start of its text, "" when it has none.
 * @param {Section} section
 * @param {BlockSketch | undefined} sketch undefined when the sketch is no longer listed
 * @param {{ seconds: number, bridge: boolean }} [development] the one the section plays, when it
 *   has one, which may be a bridge (0081)
 * @returns {{ name: string, times: string, words: string }}
 */
export function blockText({ sketchId, offset, seconds, text }, sketch, development) {
  const end = offset + seconds;
  const range = `${clockTime(offset)} to ${clockTime(end)}`;
  const words = startOf(text);
  if (!sketch)
    return { name: `Sketch ${sketchId}, no longer kept`, times: `${range}, ${seconds} s`, words };
  const duration = development?.seconds ?? sketch.duration;
  const past = end - duration;
  const extended = past > 0 ? `; extended by ${clockTime(past)} past its end` : "";
  const named = sketch.intent ? `Sketch ${sketchId}: ${sketch.intent}` : `Sketch ${sketchId}`;
  return {
    name: development ? (development.bridge ? `${named}, bridge` : `${named}, developed`) : named,
    times: `${range} of its ${development ? "development's " : ""}${clockTime(duration)}, ${seconds} s${extended}`,
    words,
  };
}

// What the track's field sets for words read and write (decision 0087): a section's length, a
// transition's kind and seconds, and a macro lane read at every `LANE_GRID_SECONDS` of the track.
// Each set's values now are read from the arrangement the page sends, its answer is applied to a
// new arrangement the validator then checks, and its reading says the part of the track it
// changes, in short lines. No I/O: the route and the page both run these.
/** @import { Arrangement, Section, Transition } from "./arrangement-schema.js" */
/** @import { LanePoint } from "./lane-schema.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
import { MACROS } from "../engine/genome-schema.js";
import { DEFAULT_CURVE } from "../engine/trajectory.js";
import { arrangementLength, sectionStarts } from "./arrangement-length.js";
import { MORPH_CURVE, morphs } from "./arrangement-schema.js";
import { laneOffsetAt, withLanePoints } from "./lane-schema.js";
import { macroWords } from "./macro-words.js";
import { exactText } from "./param-text.js";
import { quoted } from "./references-text.js";

/** What a track set changes, and so what the page's `target` names. */
export const TRACK_TARGET = Object.freeze({
  section: "section index",
  transition: "transition index",
  macro: "macro name",
});

/** @typedef {(typeof TRACK_TARGET)[keyof typeof TRACK_TARGET]} TrackTarget */

/** How far apart the lane set's times are, in track seconds. */
export const LANE_GRID_SECONDS = 30;

/**
 * How much of the track the lane set's reading says, from the most: each section with its words,
 * each section's place only, or no section.
 */
const TRACK_DETAIL = Object.freeze({ full: 0, places: 1, none: 2 });

/** @typedef {(typeof TRACK_DETAIL)[keyof typeof TRACK_DETAIL]} TrackDetail */

/**
 * What a track set reads.
 * @typedef {object} TrackContext
 * @property {Arrangement} arrangement a valid one
 * @property {number | string} target a section's or a transition's index, or a macro's name
 * @property {readonly string[]} [names] each section's name, as the route reads it from its
 *   sketch and development; the reading needs them
 * @property {TrackDetail} [detail] the lane's reading; full when absent
 */

/**
 * An answer applied: the new arrangement, and the owner's lane points it replaced.
 * @typedef {{ arrangement: Arrangement, removed: LanePoint[] }} TrackEdit
 */

/**
 * The times the lane set reads the lane at: every `LANE_GRID_SECONDS` from 0, and the track's end.
 * @param {number} length the track's, in seconds
 * @returns {number[]}
 */
export function laneGrid(length) {
  const times = [];
  for (let time = 0; time < length; time += LANE_GRID_SECONDS) times.push(time);
  times.push(length);
  return times;
}

/**
 * The lane set's field for a grid time.
 * @param {number} time track seconds
 */
export const laneField = (time) => `at${time}`;

/**
 * What a set of `kind` may name in `arrangement`.
 * @param {TrackTarget} kind
 * @param {Arrangement} arrangement
 * @returns {(number | string)[]}
 */
export function trackTargets(kind, arrangement) {
  if (kind === TRACK_TARGET.section) return arrangement.sections.map((_, i) => i);
  if (kind === TRACK_TARGET.transition) return arrangement.transitions.map((_, i) => i);
  return Object.keys(MACROS);
}

/**
 * Each section's name for the reading: its sketch, and whether it plays a development or a bridge.
 * @param {Arrangement} arrangement
 * @param {(developmentId: number) => boolean} isBridge
 * @returns {string[]}
 */
export const sectionNames = (arrangement, isBridge) =>
  arrangement.sections.map(({ sketchId, developmentId }) => {
    const sketch = `sketch ${sketchId}`;
    if (developmentId === null) return sketch;
    return isBridge(developmentId) ? `${sketch}, a bridge` : `${sketch}, developed`;
  });

/**
 * The section or transition the target names, or the macro, or a throw.
 * @param {TrackContext} context
 * @param {TrackTarget} [kind] a section when omitted
 * @returns {number}
 */
function index({ arrangement, target }, kind = TRACK_TARGET.section) {
  if (!trackTargets(kind, arrangement).includes(target)) {
    throw new Error(`the track has no ${kind} ${JSON.stringify(target)}`);
  }
  return /** @type {number} */ (target);
}

/** @param {TrackContext} context */
const transitionIndex = (context) => index(context, TRACK_TARGET.transition);

/** @param {TrackContext} context */
const macroOf = (context) =>
  /** @type {MacroName} */ (/** @type {unknown} */ (index(context, TRACK_TARGET.macro)));

/** @param {string} text */
const wordsFor = (text) =>
  text === "" ? "the owner wrote nothing for it" : `the owner's words for it: ${quoted(text)}`;

/** @param {number} seconds */
const s = (seconds) => exactText(seconds, "s");

/**
 * The track's length and arc, the lines every reading starts with.
 * @param {Arrangement} arrangement
 */
function trackLines(arrangement) {
  const count = arrangement.sections.length;
  return [
    `The track plays ${s(arrangementLength(arrangement))}, in ${count} section${count === 1 ? "" : "s"}.`,
    arrangement.arc === null
      ? "The owner wrote no arc for the track."
      : `The track's arc, as a JSON string: ${quoted(arrangement.arc)}`,
  ];
}

/**
 * One section's line: its name, its place on the track, and the owner's words unless left out.
 * @param {TrackContext} context
 * @param {number} i
 * @param {{ changed?: boolean, words?: boolean }} [how]
 */
function sectionLine({ arrangement, names }, i, { changed = false, words = true } = {}) {
  const section = /** @type {Section} */ (arrangement.sections[i]);
  const start = /** @type {number} */ (sectionStarts(arrangement)[i]);
  const name = names?.[i];
  if (name === undefined) throw new Error(`the reading needs section ${i + 1}'s name`);
  const place = `${name}, from ${s(start)} to ${s(start + section.seconds)} of the track, ${s(section.seconds)} long`;
  return `Section ${i + 1}${changed ? ", the one being changed" : ""}: ${place}${words ? `; ${wordsFor(section.text)}` : ""}`;
}

/**
 * One transition's line: its kind, seconds and curve, and the owner's words.
 * @param {Arrangement} arrangement
 * @param {number} i
 * @param {boolean} [changed]
 */
function transitionLine(arrangement, i, changed = false) {
  const { kind, seconds, curve, text } = /** @type {Transition} */ (arrangement.transitions[i]);
  const along = morphs(kind) ? ` along the ${curve} curve` : "";
  return `Section ${i + 1} into section ${i + 2}${changed ? ", the join being changed" : ""}: a ${kind} of ${s(seconds)}${along}; ${wordsFor(text)}`;
}

/**
 * The length set's reading: the track, the section with its neighbors, and the joins between.
 * @param {TrackContext} context
 * @returns {string[]}
 */
export function lengthReading(context) {
  const at = index(context);
  const { arrangement } = context;
  const near = [at - 1, at, at + 1].filter((i) => arrangement.sections[i] !== undefined);
  return [
    ...trackLines(arrangement),
    ...near.map((i) => sectionLine(context, i, { changed: i === at })),
    ...[at - 1, at]
      .filter((i) => arrangement.transitions[i] !== undefined)
      .map((i) => transitionLine(arrangement, i)),
  ];
}

/** @param {TrackContext} context */
export const lengthCurrent = (context) => ({
  seconds: /** @type {Section} */ (context.arrangement.sections[index(context)]).seconds,
});

/**
 * @param {TrackContext} context
 * @param {Readonly<Record<string, unknown>>} changes checked against the set's fields
 * @returns {TrackEdit}
 */
export function applyLength(context, changes) {
  const at = index(context);
  const { arrangement } = context;
  if (changes.seconds === undefined) return { arrangement, removed: [] };
  const seconds = /** @type {number} */ (changes.seconds);
  const sections = arrangement.sections.map((section, i) =>
    i === at ? { ...section, seconds } : section,
  );
  return { arrangement: { ...arrangement, sections }, removed: [] };
}

/**
 * The transition set's reading: the track, the two sections it joins, and the join.
 * @param {TrackContext} context
 * @returns {string[]}
 */
export function transitionReading(context) {
  const at = transitionIndex(context);
  const { arrangement } = context;
  return [
    ...trackLines(arrangement),
    sectionLine(context, at),
    sectionLine(context, at + 1),
    transitionLine(arrangement, at, true),
  ];
}

/** @param {TrackContext} context */
export function transitionCurrent(context) {
  const { kind, seconds } = /** @type {Transition} */ (
    context.arrangement.transitions[transitionIndex(context)]
  );
  return { kind, seconds };
}

/**
 * The transition with the answer's kind and seconds. A crossfade made a morph or a weave takes
 * `MORPH_CURVE`, as the kind button gives it; a morph made a weave, or back, keeps its curve; a
 * crossfade has none.
 * @param {TrackContext} context
 * @param {Readonly<Record<string, unknown>>} changes
 * @returns {TrackEdit}
 */
export function applyTransition(context, changes) {
  const at = transitionIndex(context);
  const { arrangement } = context;
  const was = /** @type {Transition} */ (arrangement.transitions[at]);
  const kind = /** @type {string} */ (changes.kind ?? was.kind);
  const seconds = /** @type {number} */ (changes.seconds ?? was.seconds);
  const curve = was.curve ?? MORPH_CURVE;
  /** @type {Transition} */
  const transition = morphs(kind)
    ? { kind, seconds, curve, text: was.text }
    : { kind, seconds, text: was.text };
  const transitions = arrangement.transitions.map((each, i) => (i === at ? transition : each));
  return { arrangement: { ...arrangement, transitions }, removed: [] };
}

/**
 * The macro's lane points; none when it has no lane.
 * @param {Arrangement} arrangement
 * @param {MacroName} macro
 * @returns {LanePoint[]}
 */
const pointsOf = (arrangement, macro) =>
  arrangement.lanes.find((lane) => lane.macro === macro)?.points ?? [];

/**
 * The lane set's reading: the track, what the macro's ends do, and each section in as much
 * detail as fits.
 * @param {TrackContext} context
 * @returns {string[]}
 */
export function laneReading(context) {
  const macro = macroOf(context);
  const { arrangement, detail = TRACK_DETAIL.full } = context;
  const { less, more } = macroWords(macro);
  return [
    ...trackLines(arrangement),
    `The lane is the ${macro} macro's: below 0 is ${less}, above 0 is ${more}, 0 as each section has it.`,
    ...(detail === TRACK_DETAIL.none
      ? []
      : arrangement.sections.map((_, i) =>
          sectionLine(context, i, { words: detail === TRACK_DETAIL.full }),
        )),
  ];
}

/**
 * The lane's reading with less of the track, or null when it says none already.
 * @param {TrackContext} context
 * @returns {TrackContext | null}
 */
export function laneNarrower(context) {
  const { detail = TRACK_DETAIL.full } = context;
  if (detail === TRACK_DETAIL.none) return null;
  return {
    ...context,
    detail: detail === TRACK_DETAIL.full ? TRACK_DETAIL.places : TRACK_DETAIL.none,
  };
}

/**
 * The lane's offset at each grid time, exact, by its field: 0 with no lane.
 * @param {TrackContext} context
 * @returns {Record<string, number>}
 */
export function laneCurrent(context) {
  const points = pointsOf(context.arrangement, macroOf(context));
  return Object.fromEntries(
    laneGrid(arrangementLength(context.arrangement)).map((time) => [
      laneField(time),
      points.length === 0 ? 0 : laneOffsetAt(points, time),
    ]),
  );
}

/**
 * The lane with the answer's times as its points. The answer's times are breakpoints, moved
 * between evenly; before the first and after the last the lane stays as it was, held by a point
 * at the grid time on either side at its value there. The owner's points between those two held
 * times are replaced, and returned so the page names them; the rest stay with their curves. An
 * answer that gives every time its value now changes nothing.
 * @param {TrackContext} context
 * @param {Readonly<Record<string, unknown>>} changes
 * @returns {TrackEdit}
 */
export function applyLane(context, changes) {
  const macro = macroOf(context);
  const { arrangement } = context;
  const now = laneCurrent(context);
  const grid = laneGrid(arrangementLength(arrangement));
  const given = grid.flatMap((time, i) => (changes[laneField(time)] === undefined ? [] : [i]));
  if (
    given.every(
      (i) =>
        changes[laneField(/** @type {number} */ (grid[i]))] ===
        now[laneField(/** @type {number} */ (grid[i]))],
    )
  ) {
    return { arrangement, removed: [] };
  }
  const first = /** @type {number} */ (given[0]);
  const last = /** @type {number} */ (given.at(-1));
  const before = first > 0 ? /** @type {number} */ (grid[first - 1]) : null;
  const after = last < grid.length - 1 ? /** @type {number} */ (grid[last + 1]) : null;
  const from = /** @type {number} */ (grid[first]);
  const to = /** @type {number} */ (grid[last]);
  /** @param {number} time */
  const replaced = (time) =>
    (before === null ? time >= from : time > before) &&
    (after === null ? time <= to : time < after);
  const points = pointsOf(arrangement, macro);
  const removed = points.filter(([time]) => replaced(time));
  const kept = points.filter(([time]) => !replaced(time));
  /** @param {number | null} time */
  const held = (time) =>
    time === null || kept.some(([at]) => at === time)
      ? []
      : [
          /** @type {LanePoint} */ ([
            time,
            /** @type {number} */ (now[laneField(time)]),
            DEFAULT_CURVE,
          ]),
        ];
  const added = [
    ...held(before),
    ...given.map((i) => {
      const time = /** @type {number} */ (grid[i]);
      return /** @type {LanePoint} */ ([
        time,
        /** @type {number} */ (changes[laneField(time)]),
        DEFAULT_CURVE,
      ]);
    }),
    ...held(after),
  ];
  // A point of the owner's that was first and no longer is names the curve into it, as every
  // point after the first does: an even one, which keeps the lane held before it as it was.
  const merged = [...kept, ...added]
    .sort(([a], [b]) => a - b)
    .map(
      (point) => /** @type {LanePoint} */ (point.length === 2 ? [...point, DEFAULT_CURVE] : point),
    );
  return { arrangement: withLanePoints(arrangement, macro, merged), removed };
}

// The timeline's edits (decision 0061), with no DOM: each takes an arrangement and returns a new
// one, leaving the one given as it was. An edit can make an arrangement `validateArrangement`
// refuses, such as a crossfade longer than half a section after the section shrinks; the page
// shows the errors and Save waits for the owner to fix them, rather than an edit changing a
// value the owner didn't touch.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
import {
  SECTION_FIELDS,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "../domain/arrangement-schema.js";

/** The edges of a block a drag moves. */
export const EDGE = Object.freeze({ start: "start", end: "end" });

/** @typedef {(typeof EDGE)[keyof typeof EDGE]} Edge */

/** How far a key or a step button moves a section's seconds or offset. */
export const SECTION_STEP = 10;
/** How far a key or a step button moves a crossfade. */
export const TRANSITION_STEP = 1;

/** @param {number} value */
const tenths = (value) => Math.round(value * 10) / 10;

/**
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {(section: Section) => Section} change
 * @returns {Arrangement}
 */
function changeSection(arrangement, index, change) {
  const sections = arrangement.sections.map((section, i) =>
    i === index ? change(section) : section,
  );
  return { ...arrangement, sections };
}

/**
 * Adds a section of the sketch after section `after`, or first when null, playing the sketch
 * from its start for `SECTION_FIELDS.seconds`'s default or the whole sketch when shorter. Its
 * crossfade is the default, or half the shorter neighbor when that is less.
 * @param {Arrangement} arrangement
 * @param {{ id: number, duration: number }} sketch
 * @param {number | null} after
 * @returns {{ arrangement: Arrangement, index: number }}
 */
export function addSection(arrangement, sketch, after) {
  const { seconds: field } = SECTION_FIELDS;
  const section = {
    sketchId: sketch.id,
    offset: 0,
    seconds: Math.max(field.min, Math.min(field.default, sketch.duration)),
  };
  const index = after === null ? 0 : after + 1;
  const sections = arrangement.sections.toSpliced(index, 0, section);
  if (sections.length === 1) return { arrangement: { ...arrangement, sections }, index };
  const neighbor = /** @type {Section} */ (sections[index === 0 ? 1 : index - 1]);
  const seconds = Math.max(
    TRANSITION_SECONDS.min,
    Math.min(TRANSITION_SECONDS.default, Math.min(section.seconds, neighbor.seconds) / 2),
  );
  // The new crossfade sits between the new section and the neighbor it was placed beside.
  const at = index === 0 ? 0 : index - 1;
  const transitions = arrangement.transitions.toSpliced(at, 0, {
    kind: TRANSITION_KIND.crossfade,
    seconds,
  });
  return { arrangement: { ...arrangement, sections, transitions }, index };
}

/**
 * Removes section `index` and the crossfade after it, or before it when it is the last.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @returns {Arrangement}
 */
export function removeSection(arrangement, index) {
  const sections = arrangement.sections.toSpliced(index, 1);
  const at = index < arrangement.transitions.length ? index : index - 1;
  const transitions = at < 0 ? arrangement.transitions : arrangement.transitions.toSpliced(at, 1);
  return { ...arrangement, sections, transitions };
}

/**
 * Swaps section `index` with its neighbor `step` (−1 or 1) away; the crossfades stay where they
 * are, between the same places. At either end it stays.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {-1 | 1} step
 * @returns {{ arrangement: Arrangement, index: number }}
 */
export function moveSection(arrangement, index, step) {
  const to = index + step;
  if (to < 0 || to >= arrangement.sections.length) return { arrangement, index };
  const sections = arrangement.sections.slice();
  [sections[index], sections[to]] = [
    /** @type {Section} */ (sections[to]),
    /** @type {Section} */ (sections[index]),
  ];
  return { arrangement: { ...arrangement, sections }, index: to };
}

/**
 * Sets a section's offset or seconds from the fields, as typed.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {{ offset?: number, seconds?: number }} values
 * @returns {Arrangement}
 */
export const setSection = (arrangement, index, values) =>
  changeSection(arrangement, index, (section) => ({ ...section, ...values }));

/**
 * Moves a section's offset or seconds by `steps` of `SECTION_STEP`, never under the field's
 * least.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {keyof typeof SECTION_FIELDS} field
 * @param {number} steps
 * @returns {Arrangement}
 */
export const stepSection = (arrangement, index, field, steps) =>
  changeSection(arrangement, index, (section) => ({
    ...section,
    [field]: Math.max(SECTION_FIELDS[field].min, tenths(section[field] + steps * SECTION_STEP)),
  }));

/**
 * Drags one edge of a block by `seconds`. The end edge changes how long the section plays; the
 * start edge moves where it starts on its sketch and keeps where it ends, stopping at the
 * sketch's start and at the least seconds.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {Edge} edge
 * @param {number} seconds
 * @returns {Arrangement}
 */
export function dragEdge(arrangement, index, edge, seconds) {
  const least = SECTION_FIELDS.seconds.min;
  return changeSection(arrangement, index, (section) => {
    if (edge === EDGE.end) {
      return { ...section, seconds: Math.max(least, tenths(section.seconds + seconds)) };
    }
    const end = section.offset + section.seconds;
    const offset = Math.min(end - least, Math.max(0, tenths(section.offset + seconds)));
    return { ...section, offset, seconds: tenths(end - offset) };
  });
}

/**
 * The crossfade the keys change for section `index`: the one after it, or before the last; null
 * with one section or none.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @returns {number | null}
 */
export function transitionOf({ transitions }, index) {
  if (transitions.length === 0) return null;
  return Math.min(index, transitions.length - 1);
}

/**
 * Sets crossfade `index`'s seconds, as typed.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {number} seconds
 * @returns {Arrangement}
 */
export const setTransition = (arrangement, index, seconds) => ({
  ...arrangement,
  transitions: arrangement.transitions.map((transition, i) =>
    i === index ? { ...transition, seconds } : transition,
  ),
});

/**
 * Moves crossfade `index` by `steps` of `TRANSITION_STEP`, never under its least.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {number} steps
 * @returns {Arrangement}
 */
export function stepTransition(arrangement, index, steps) {
  const now = /** @type {{ seconds: number }} */ (arrangement.transitions[index]).seconds;
  const seconds = Math.max(TRANSITION_SECONDS.min, tenths(now + steps * TRANSITION_STEP));
  return setTransition(arrangement, index, seconds);
}

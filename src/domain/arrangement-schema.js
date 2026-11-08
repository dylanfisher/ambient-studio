// A track's arrangement (decision 0061), in the descriptor style of 0005 and 0020: the numbers
// a section and a transition hold are descriptors, read by `validateArrangement` and by the
// timeline page's fields. Stored as a track revision's JSON, every key present.
/** @import { NumberDescriptor } from "../engine/descriptor.js" */
import { number } from "../engine/descriptor.js";
import { MAX_DURATION } from "../engine/timeline.js";

/** The longest track, in seconds: phase 6's 20 minutes, which its memory ceiling is set for. */
export const MAX_TRACK_SECONDS = 1200;

/** The longest arc the owner writes, in characters. */
export const MAX_ARC_CHARS = 200;

/** The arrangement's keys, in the order a stored one lists them. */
export const ARRANGEMENT_KEY = Object.freeze({
  length: "length",
  arc: "arc",
  sections: "sections",
  transitions: "transitions",
  lanes: "lanes",
  proposal: "proposal",
});

/** How one section passes to the next. 6e adds the morph. */
export const TRANSITION_KIND = Object.freeze({ crossfade: "crossfade" });

/**
 * The track length the owner asks for, from 3 to 20 minutes; null on a hand-made track.
 * @type {NumberDescriptor}
 */
export const TRACK_LENGTH = number({
  min: 180,
  max: MAX_TRACK_SECONDS,
  default: 600,
  unit: "s",
  description: "the track length the owner asked for",
});

/** A section's keys, by name: the sketch it plays and the numbers in `SECTION_FIELDS`. */
export const SECTION_KEY = Object.freeze({
  sketchId: "sketchId",
  offset: "offset",
  seconds: "seconds",
});

/**
 * A section's numbers. `offset` is where it starts on its sketch's timeline; the section may run
 * past the sketch's end, which extends the sketch's genome (0061), but not past `MAX_DURATION`.
 * @type {Readonly<Record<"offset" | "seconds", NumberDescriptor>>}
 */
export const SECTION_FIELDS = Object.freeze({
  [SECTION_KEY.offset]: number({
    min: 0,
    max: MAX_DURATION,
    default: 0,
    unit: "s",
    description: "where the section starts on its sketch's timeline",
  }),
  [SECTION_KEY.seconds]: number({
    min: 10,
    max: MAX_DURATION,
    default: 120,
    unit: "s",
    description: "how long the section plays",
  }),
});

/** A section's keys, in the order a stored one lists them. */
export const SECTION_KEYS = Object.freeze(Object.values(SECTION_KEY));

/**
 * A transition's length: it overlaps the end of the section before it and the start of the one
 * after by this much, and is at most half the shorter of the two.
 * @type {NumberDescriptor}
 */
export const TRANSITION_SECONDS = number({
  min: 1,
  max: MAX_DURATION / 2,
  default: 8,
  unit: "s",
  description: "how long the transition overlaps its two sections",
});

/** A transition's keys. */
export const TRANSITION_KEYS = Object.freeze(["kind", "seconds"]);

/**
 * @typedef {object} Section
 * @property {number} sketchId a live sketch of the track's vibe
 * @property {number} offset seconds on the sketch's timeline
 * @property {number} seconds
 */

/**
 * @typedef {object} Transition
 * @property {string} kind a `TRANSITION_KIND` value
 * @property {number} seconds
 */

/**
 * @typedef {object} Arrangement
 * @property {number | null} length the owner's, in seconds
 * @property {string | null} arc the owner's, in words
 * @property {Section[]} sections in the order they play
 * @property {Transition[]} transitions one between each pair of neighbors
 * @property {unknown[]} lanes empty until 6f's macro lanes
 * @property {number | null} proposal the generation a proposed arrangement came from (6h)
 */

/** @returns {Arrangement} a new track's: no sections and nothing asked for */
export const emptyArrangement = () => ({
  length: null,
  arc: null,
  sections: [],
  transitions: [],
  lanes: [],
  proposal: null,
});

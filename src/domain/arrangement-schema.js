// A track's arrangement (decision 0061), in the descriptor style of 0005 and 0020: the numbers
// a section and a transition hold are descriptors, read by `validateArrangement` and by the
// timeline page's fields. Stored as a track revision's JSON, every key present.
/** @import { NumberDescriptor } from "../engine/descriptor.js" */
/** @import { Curve } from "../engine/trajectory.js" */
/** @import { Lane } from "./lane-schema.js" */
import { number } from "../engine/descriptor.js";
import { MAX_DURATION } from "../engine/timeline.js";

/** The longest track, in seconds: phase 6's 20 minutes, which its memory ceiling is set for. */
export const MAX_TRACK_SECONDS = 1200;

/** The longest arc the owner writes, in characters. */
export const MAX_ARC_CHARS = 200;

/** The longest text the owner writes on a section or a transition, in characters (0077). */
export const MAX_TEXT_CHARS = 300;

/**
 * The key of the owner's words on a section and on a transition: what should happen in that
 * part of the track. "" when there are none; never part of what renders (0077).
 */
export const TEXT_KEY = "text";

/** The arrangement's keys, in the order a stored one lists them. */
export const ARRANGEMENT_KEY = Object.freeze({
  length: "length",
  arc: "arc",
  sections: "sections",
  transitions: "transitions",
  lanes: "lanes",
  proposal: "proposal",
});

/**
 * How one section passes to the next: a crossfade of the two, or a morph of the first into the
 * second (decision 0064), which falls back to a crossfade when the two can't morph.
 */
export const TRANSITION_KIND = Object.freeze({ crossfade: "crossfade", morph: "morph" });

/**
 * A new morph's curve: no corner where it starts or ends.
 * @type {Curve}
 */
export const MORPH_CURVE = "smooth";

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

/**
 * A section's keys, by name: the sketch it plays, the numbers in `SECTION_FIELDS`, and the
 * owner's text.
 */
export const SECTION_KEY = Object.freeze({
  sketchId: "sketchId",
  offset: "offset",
  seconds: "seconds",
  text: TEXT_KEY,
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

/**
 * A transition's keys by its kind, in the order a stored one lists them: a morph also names the
 * curve its parameters move by.
 */
export const TRANSITION_KEYS = Object.freeze({
  [TRANSITION_KIND.crossfade]: Object.freeze(["kind", "seconds", TEXT_KEY]),
  [TRANSITION_KIND.morph]: Object.freeze(["kind", "seconds", "curve", TEXT_KEY]),
});

/**
 * @typedef {object} Section
 * @property {number} sketchId a live sketch of the track's vibe
 * @property {number} offset seconds on the sketch's timeline
 * @property {number} seconds
 * @property {string} text the owner's words for what happens in it, or ""
 */

/**
 * @typedef {object} Transition
 * @property {string} kind a `TRANSITION_KIND` value
 * @property {number} seconds
 * @property {string} [curve] a morph's: one of 0007's `CURVES`
 * @property {string} text the owner's words for how one section becomes the next, or ""
 */

/**
 * @typedef {object} Arrangement
 * @property {number | null} length the owner's, in seconds
 * @property {string | null} arc the owner's, in words
 * @property {Section[]} sections in the order they play
 * @property {Transition[]} transitions one between each pair of neighbors
 * @property {Lane[]} lanes at most one per macro (decision 0065)
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

// A bridge (decision 0081): a passage the model writes for one join of a track, put between the
// join's two sections. It starts where the outgoing section ends and ends where the incoming one
// starts, so a weave (0080) joins it to each. A genome has one tuning, scale, key, pulse and bpm,
// and a weave can't move between two of them, so a bridge between sections that differ in any
// is two halves: the first in the outgoing section's, the second in the incoming one's, with a
// crossfade between them over which only voices with no pitch sound when the key or tuning
// changes.
/** @import { Arrangement, Section } from "./arrangement-schema.js" */
/** @import { NumberDescriptor } from "../engine/descriptor.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { SectionGenomes } from "./section-genome.js" */
import { number } from "../engine/descriptor.js";
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";
import { MORPH_LEAST } from "../engine/morph.js";
import { MAX_DURATION } from "../engine/timeline.js";
import { arrangementLength } from "./arrangement-length.js";
import {
  MAX_TRACK_SECONDS,
  MORPH_CURVE,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "./arrangement-schema.js";
import { JOIN_GLOBALS } from "./morph-genome.js";
import { paramName } from "./param-name.js";
import { fittedGenome } from "./section-genome.js";

/**
 * How long a bridge plays, the owner's to set: each part is a genome, so from a genome's least
 * duration (`DEVELOP_LEAST`'s) to `MAX_DURATION`. Two halves need twice the least.
 * @type {NumberDescriptor}
 */
export const BRIDGE_SECONDS = number({
  min: GLOBAL_PARAMS.duration.min,
  max: MAX_DURATION,
  default: 120,
  unit: "s",
  description: "how long a bridge plays",
});

/**
 * Each weave into and out of a bridge: twice `MORPH_LEAST`, so it moves for 12 s before its 4 s
 * handover. Less when a neighbor is shorter than twice this, as any transition is at most half
 * the shorter of its sections.
 */
const BRIDGE_JOIN_SECONDS = 2 * MORPH_LEAST;

/** The crossfade between a bridge's two halves: a new transition's default. */
const BRIDGE_MIDDLE_SECONDS = TRANSITION_SECONDS.default;

/** Which part of a bridge a request writes: the whole of it, or one of its two halves. */
export const BRIDGE_PART = Object.freeze(
  /** @type {const} */ ({ whole: "whole", first: "first", second: "second" }),
);

/** @typedef {(typeof BRIDGE_PART)[keyof typeof BRIDGE_PART]} BridgePart */

/** The globals that set what pitch a note has; voices that read them can't cross a change. */
const KEY_GLOBALS = Object.freeze(
  [GLOBAL_PARAMS.tuning, GLOBAL_PARAMS.scale, GLOBAL_PARAMS.key].map(
    (descriptor) => /** @type {keyof Genome} */ (paramName(GLOBAL_PARAMS, descriptor)),
  ),
);

/**
 * The join globals two genomes differ in, which a weave can't move.
 * @param {Genome} out
 * @param {Genome} into
 * @returns {(keyof Genome)[]}
 */
const joinDifferences = (out, into) => JOIN_GLOBALS.filter((name) => out[name] !== into[name]);

/**
 * How a bridge of one join is laid out: each part's sketch and seconds, the weave into it and out
 * of it, and between two halves the crossfade and whether only voices with no pitch cross it.
 * @typedef {object} BridgePlan
 * @property {{ sketchId: number, seconds: number }[]} parts one, or two halves: the first plays
 *   the outgoing section's sketch, the second the incoming one's
 * @property {number} into the weave's seconds from the outgoing section into the bridge
 * @property {number} out the weave's seconds from the bridge into the incoming section
 * @property {number | null} middle the crossfade's seconds between two halves; null for one part
 * @property {(keyof Genome)[]} differs the join globals the two sections differ in
 * @property {boolean} keyless whether only voices with no pitch may sound across the middle: the
 *   key or tuning changes there
 */

/**
 * A weave's seconds beside a section of `seconds`: `BRIDGE_JOIN_SECONDS`, or half the section
 * when that is less, in tenths.
 * @param {number} seconds
 */
const joinSeconds = (seconds) => Math.min(BRIDGE_JOIN_SECONDS, Math.floor((seconds / 2) * 10) / 10);

/**
 * The bridge of `seconds` for transition `index`, or why it can't be one.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index the transition's
 * @param {number} seconds the owner's
 * @param {SectionGenomes} genomes
 * @returns {({ ok: true } & BridgePlan) | { ok: false, reason: string }}
 */
export function bridgePlan(arrangement, index, seconds, genomes) {
  const out = arrangement.sections[index];
  const into = arrangement.sections[index + 1];
  if (!out || !into) throw new Error(`there is no transition ${index + 1}`);
  const differs = joinDifferences(
    fittedGenome(arrangement, index, genomes),
    fittedGenome(arrangement, index + 1, genomes),
  );
  const halves = differs.length > 0;
  const least = halves ? 2 * BRIDGE_SECONDS.min : BRIDGE_SECONDS.min;
  if (!(seconds >= least && seconds <= BRIDGE_SECONDS.max)) {
    return {
      ok: false,
      reason: halves
        ? `sections ${index + 1} and ${index + 2} differ in ${differs.join(", ")}, which one genome can't change, so the bridge is two halves of at least ${BRIDGE_SECONDS.min} s each: from ${least} to ${BRIDGE_SECONDS.max} s, not ${seconds} s`
        : `a bridge plays from ${least} to ${BRIDGE_SECONDS.max} s, not ${seconds} s`,
    };
  }
  for (const [i, section] of [
    [index, out],
    [index + 1, into],
  ].map(([i, section]) => /** @type {[number, Section]} */ ([i, section]))) {
    if (joinSeconds(section.seconds) < MORPH_LEAST) {
      return {
        ok: false,
        reason: `section ${i + 1} plays ${section.seconds} s; a weave into a bridge is at least ${MORPH_LEAST} s and at most half its section, so the section must play at least ${2 * MORPH_LEAST} s`,
      };
    }
  }
  const first = halves ? Math.floor(seconds / 2) : seconds;
  /** @type {BridgePlan} */
  const plan = {
    parts: [
      { sketchId: out.sketchId, seconds: first },
      ...(halves ? [{ sketchId: into.sketchId, seconds: seconds - first }] : []),
    ],
    into: joinSeconds(out.seconds),
    out: joinSeconds(into.seconds),
    middle: halves ? BRIDGE_MIDDLE_SECONDS : null,
    differs,
    keyless: differs.some((name) => KEY_GLOBALS.includes(name)),
  };
  const length = arrangementLength(
    bridgedArrangement(
      arrangement,
      index,
      plan,
      plan.parts.map(() => null),
      "",
    ),
  );
  if (length > MAX_TRACK_SECONDS) {
    return {
      ok: false,
      reason: `with it the track would play ${length} s; a track is at most ${MAX_TRACK_SECONDS} s`,
    };
  }
  return { ok: true, ...plan };
}

/**
 * The arrangement with a bridge in place of transition `index`: its parts as sections between
 * the two, each playing its development from 0 with the words it was written from, a weave of
 * no words on each side, and the crossfade between two halves.
 * @param {Arrangement} arrangement
 * @param {number} index the transition's
 * @param {Pick<BridgePlan, "parts" | "into" | "out" | "middle">} plan
 * @param {readonly (number | null)[]} developmentIds each part's, in order
 * @param {string} text the words the bridge was written from
 * @returns {Arrangement}
 */
export function bridgedArrangement(arrangement, index, plan, developmentIds, text) {
  if (developmentIds.length !== plan.parts.length) {
    throw new Error(`a bridge of ${plan.parts.length} parts needs as many developments`);
  }
  const sections = plan.parts.map(({ sketchId, seconds }, i) => ({
    sketchId,
    offset: 0,
    seconds,
    text,
    developmentId: /** @type {number | null} */ (developmentIds[i]),
  }));
  /** @param {number} seconds */
  const weave = (seconds) => ({
    kind: TRANSITION_KIND.weave,
    seconds,
    curve: MORPH_CURVE,
    text: "",
  });
  const transitions = [
    weave(plan.into),
    ...(plan.middle === null
      ? []
      : [{ kind: TRANSITION_KIND.crossfade, seconds: plan.middle, text: "" }]),
    weave(plan.out),
  ];
  return {
    ...arrangement,
    sections: arrangement.sections.toSpliced(index + 1, 0, ...sections),
    transitions: arrangement.transitions.toSpliced(index, 1, ...transitions),
  };
}

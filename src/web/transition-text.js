// What the timeline says of the chosen transition (decision 0064): a crossfade, a morph with its
// curve, or a morph that plays as a crossfade and why. No DOM here, so the wording is tested.
/** @import { Transition } from "../domain/arrangement-schema.js" */
/** @import { Curve } from "../engine/trajectory.js" */
import { TRANSITION_KIND } from "../domain/arrangement-schema.js";
import { MORPH_HANDOVER } from "../engine/morph.js";

/** Each curve's shape, in the words 0007 gives it. */
const CURVE_WORDS = Object.freeze(
  /** @type {Record<Curve, string>} */ ({
    linear: "an even move",
    smooth: "easing in and out",
    early: "most of the change near the start",
    late: "most of the change near the end",
  }),
);

/**
 * @param {number} index the transition's, counted from 0
 * @param {Transition} transition
 * @param {{ ok: true } | { ok: false, reason: string } | null} morph whether a morph holds, from
 *   `sectionMorph`; null when it isn't known, as while the timeline has errors
 * @returns {string}
 */
export function transitionText(index, transition, morph) {
  const [from, into] = [`section ${index + 1}`, `section ${index + 2}`];
  if (transition.kind !== TRANSITION_KIND.morph) return `The crossfade from ${from} into ${into}.`;
  if (morph && !morph.ok) {
    return `Section ${index + 1} plays into ${into} as a crossfade, not a morph: ${morph.reason}.`;
  }
  const curve = /** @type {Curve} */ (transition.curve);
  return `Section ${index + 1} morphs into ${into} along the ${curve} curve, ${CURVE_WORDS[curve]}: its sounds move toward ${into}'s for ${transition.seconds - MORPH_HANDOVER} s, then ${into} takes over in the last ${MORPH_HANDOVER} s.`;
}

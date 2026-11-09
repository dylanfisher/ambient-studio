// What the timeline says of the chosen transition (decisions 0064 and 0080): a crossfade, a morph
// or a weave with its curve, or one that plays as a crossfade and why. No DOM here, so the
// wording is tested.
/** @import { Transition } from "../domain/arrangement-schema.js" */
/** @import { Handover } from "../domain/morph-genome.js" */
/** @import { Curve } from "../engine/trajectory.js" */
import { morphs, TRANSITION_KIND } from "../domain/arrangement-schema.js";
import { MORPH_HANDOVER, MORPH_LEAST, voiceOfInstance } from "../engine/morph.js";

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
 * What the kind button says, by the kind it steps from: M's order.
 * @type {Readonly<Record<string, string>>}
 */
const KIND_BUTTON = Object.freeze({
  [TRANSITION_KIND.crossfade]: "Make it a morph",
  [TRANSITION_KIND.morph]: "Make it a weave",
  [TRANSITION_KIND.weave]: "Make it a crossfade",
});

/**
 * A curve's shape in plain words, for its button.
 * @param {Curve} curve
 */
export const curveWords = (curve) => CURVE_WORDS[curve];

/**
 * The kind button's words for a transition of `kind`: the kind it becomes.
 * @param {string} kind
 */
export const kindButtonWords = (kind) => {
  const words = KIND_BUTTON[kind];
  if (words === undefined) throw new Error(`there is no transition kind ${JSON.stringify(kind)}`);
  return words;
};

/**
 * A weave's handovers in its order, each side's voices by the names their sketches give them.
 * @param {readonly Handover[]} order
 */
function handoverWords(order) {
  if (order.length === 0)
    return " No sound hands over on its own here, so it plays as a morph would.";
  /** @param {boolean} leaves */
  const side = (leaves) =>
    order
      .filter((handover) => handover.leaves === leaves)
      .map(({ id }) => (leaves ? id : voiceOfInstance(id)))
      .join(", then ");
  const [leaving, entering] = [side(true), side(false)];
  return `${leaving && ` Leaving: ${leaving}.`}${entering && ` Coming in: ${entering}.`}`;
}

/**
 * @param {number} index the transition's, counted from 0
 * @param {Transition} transition
 * @param {{ ok: true, order?: readonly Handover[] } | { ok: false, reason: string } | null} morph
 *   whether a morph or weave holds, and a weave's order, from `sectionMorph`; null when it isn't
 *   known, as while the timeline has errors
 * @returns {string}
 */
export function transitionText(index, transition, morph) {
  const [from, into] = [`section ${index + 1}`, `section ${index + 2}`];
  if (!morphs(transition.kind)) return `The crossfade from ${from} into ${into}.`;
  const weave = transition.kind === TRANSITION_KIND.weave;
  if (transition.seconds < MORPH_LEAST) {
    const short = MORPH_LEAST - transition.seconds;
    return weave
      ? `A weave needs at least ${MORPH_LEAST} s: its sounds hand over, then ${into} takes over in the last ${MORPH_HANDOVER} s. Make this one ${short} s longer, or make it a crossfade.`
      : `A morph needs at least ${MORPH_LEAST} s: its sounds move, then ${into} takes over in the last ${MORPH_HANDOVER} s. Make this one ${short} s longer, or make it a crossfade again.`;
  }
  if (morph && !morph.ok) {
    return `Section ${index + 1} plays into ${into} as a crossfade, not a ${transition.kind}: ${morph.reason}.`;
  }
  const curve = /** @type {Curve} */ (transition.curve);
  const moves = transition.seconds - MORPH_HANDOVER;
  if (!weave) {
    return `Section ${index + 1} morphs into ${into} along the ${curve} curve, ${CURVE_WORDS[curve]}: its sounds move toward ${into}'s for ${moves} s, then ${into} takes over in the last ${MORPH_HANDOVER} s.`;
  }
  const general = `Section ${index + 1} weaves into ${into} along the ${curve} curve, ${CURVE_WORDS[curve]}: for ${moves} s the sounds both play move toward ${into}'s, while the others hand over one at a time, ${from}'s leaving from the highest down as ${into}'s come in from the lowest up; then ${into} takes over in the last ${MORPH_HANDOVER} s.`;
  return morph?.order ? `${general}${handoverWords(morph.order)}` : general;
}

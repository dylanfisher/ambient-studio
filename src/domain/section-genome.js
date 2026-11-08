// A sketch's genome fitted to its section of a track (decision 0062). Every audio path of a
// track goes through here: the render, the seam preview, the cost, stems (0063), morphs
// (`morphGenome`, 0064) and macro lanes (`applyLanes`, 0065).
/** @import { Arrangement } from "./arrangement-schema.js" */
/** @import { Morph } from "./morph-genome.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Curve } from "../engine/trajectory.js" */
import { MORPH_HANDOVER } from "../engine/morph.js";
import { requireGenome } from "../engine/validate-genome.js";
import { applyLanes } from "./apply-lanes.js";
import { sectionStarts } from "./arrangement-length.js";
import { TRANSITION_KIND } from "./arrangement-schema.js";
import { morphGenome } from "./morph-genome.js";

/**
 * The sketch's genome for its section, normalized, before any morph:
 * - no master fade, since a section's window rarely starts at its sketch's 0 or ends at its
 *   duration, where the genome's fades sit; the track's own fades come from `trackFades`;
 * - when the section runs past the sketch's end (0061's extend), `duration` raised to the
 *   section's end and each voice that reached the old end moved to the new one. Trajectories
 *   hold past their last point (0007), so they are left as they are.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index the section's
 * @param {ReadonlyMap<number, unknown>} genomes each sketch's stored genome, by sketch id
 * @returns {Genome}
 */
function fittedGenome(arrangement, index, genomes) {
  const section = arrangement.sections[index];
  if (!section) throw new Error(`there is no section ${index + 1}`);
  const stored = genomes.get(section.sketchId);
  if (stored === undefined) {
    throw new Error(
      `section ${index + 1} plays sketch ${section.sketchId}, which has no genome here`,
    );
  }
  const genome = requireGenome(stored, `sketch ${section.sketchId}'s genome`);
  const end = section.offset + section.seconds;
  const extended = end > genome.duration;
  const fitted = {
    ...genome,
    fadeIn: 0,
    fadeOut: 0,
    ...(extended && {
      duration: end,
      voices: genome.voices.map((voice) =>
        voice.end >= genome.duration ? { ...voice, end: Math.max(voice.end, end) } : voice,
      ),
    }),
  };
  return requireGenome(fitted, `section ${index + 1}'s genome`);
}

/**
 * The morph from section `index` into the next, or null when their transition is a crossfade
 * or there is none. A morph that can't hold says why, and plays as a crossfade.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index the outgoing section's
 * @param {ReadonlyMap<number, unknown>} genomes
 * @returns {Morph | null}
 */
export function sectionMorph(arrangement, index, genomes) {
  const transition = arrangement.transitions[index];
  if (transition?.kind !== TRANSITION_KIND.morph) return null;
  const out = /** @type {import("./arrangement-schema.js").Section} */ (
    arrangement.sections[index]
  );
  const into = /** @type {import("./arrangement-schema.js").Section} */ (
    arrangement.sections[index + 1]
  );
  return morphGenome(
    {
      genome: fittedGenome(arrangement, index, genomes),
      at: out.offset + out.seconds - transition.seconds,
    },
    { genome: fittedGenome(arrangement, index + 1, genomes), at: into.offset },
    transition.seconds,
    /** @type {Curve} */ (transition.curve),
  );
}

/**
 * The genome a section renders: its fitted genome, or the morph into the next section when
 * their transition is a morph that holds, with the track's macro lanes added over the section's
 * span of the track. A morph's genome is on the outgoing section's timeline, so the span is the
 * same.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index the section's
 * @param {ReadonlyMap<number, unknown>} genomes each sketch's stored genome, by sketch id
 * @returns {Genome}
 */
export function sectionGenome(arrangement, index, genomes) {
  const morph = sectionMorph(arrangement, index, genomes);
  const genome = morph?.ok ? morph.genome : fittedGenome(arrangement, index, genomes);
  const { offset, seconds } = /** @type {import("./arrangement-schema.js").Section} */ (
    arrangement.sections[index]
  );
  const at = /** @type {number} */ (sectionStarts(arrangement)[index]);
  return applyLanes(genome, arrangement.lanes, { at, from: offset, to: offset + seconds });
}

/**
 * The window of its genome's timeline a section renders. A section a morph leads into renders
 * from the morph's handover: before it, the morph's genome plays its voices.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index the section's
 * @param {ReadonlyMap<number, unknown>} genomes
 * @returns {{ offset: number, duration: number }} timeline seconds
 */
export function sectionWindow(arrangement, index, genomes) {
  const section = arrangement.sections[index];
  if (!section) throw new Error(`there is no section ${index + 1}`);
  const before = arrangement.transitions[index - 1];
  const late =
    before && sectionMorph(arrangement, index - 1, genomes)?.ok
      ? before.seconds - MORPH_HANDOVER
      : 0;
  return { offset: section.offset + late, duration: section.seconds - late };
}

/**
 * Transition `index` as the mix renders it: a crossfade of its seconds, or a morph's handover,
 * a crossfade of `MORPH_HANDOVER` at the morph's end, with the morph's seconds and curve.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index
 * @param {ReadonlyMap<number, unknown>} genomes
 * @returns {{ kind: string, seconds: number, morphSeconds?: number, curve?: Curve }}
 */
export function renderedTransition(arrangement, index, genomes) {
  const transition = arrangement.transitions[index];
  if (!transition) throw new Error(`there is no transition ${index + 1}`);
  if (!sectionMorph(arrangement, index, genomes)?.ok) {
    return { kind: TRANSITION_KIND.crossfade, seconds: transition.seconds };
  }
  return {
    kind: TRANSITION_KIND.morph,
    seconds: MORPH_HANDOVER,
    morphSeconds: transition.seconds,
    curve: /** @type {Curve} */ (transition.curve),
  };
}

/**
 * The ids of the renamed instances in the genome a section renders: a morph's, else none. A stem
 * (0063) gathers each under `voiceOfInstance` of its id.
 * @param {Arrangement} arrangement a valid one
 * @param {number} index the section's
 * @param {ReadonlyMap<number, unknown>} genomes
 * @returns {string[]}
 */
export function sectionInstances(arrangement, index, genomes) {
  const morph = sectionMorph(arrangement, index, genomes);
  return morph?.ok ? morph.instances : [];
}

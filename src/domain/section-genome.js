// A sketch's genome fitted to its section of a track (decision 0062). Every audio path of a
// track goes through here: the render, the seam preview, the cost and, later, stems (6d), morphs
// (6e's `morphGenome`) and macro lanes (6f's `applyLanes`).
/** @import { Arrangement } from "./arrangement-schema.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { requireGenome } from "../engine/validate-genome.js";

/**
 * The genome a section renders, normalized:
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
export function sectionGenome(arrangement, index, genomes) {
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

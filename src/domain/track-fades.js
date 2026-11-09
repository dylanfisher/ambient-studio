// A track's own fade-in and fade-out (decision 0062). Section genomes play no master fade
// (`sectionGenome`), since a section's window rarely reaches its sketch's 0 or its end, where the
// genome's fades sit; the track instead fades in as its first sketch does and out as its last
// does, on the master bus's curve, applied to the mix.
/** @import { Arrangement } from "./arrangement-schema.js" */
/** @import { SectionGenomes } from "./section-genome.js" */
import { CURVES } from "../engine/trajectory.js";
import { requireGenome } from "../engine/validate-genome.js";
import { arrangementLength } from "./arrangement-length.js";

/**
 * The fades' lengths in seconds: the first section's sketch's `fadeIn` and the last one's
 * `fadeOut`, scaled down together when they add up to more than the track. A developed section
 * fades as its sketch does: a development is written to play inside a track, with no fades of its
 * own (0079).
 * @param {Arrangement} arrangement a valid one
 * @param {SectionGenomes} genomes the sketches' genomes by id, which the fades read
 * @returns {{ fadeIn: number, fadeOut: number }}
 */
export function trackFades(arrangement, genomes) {
  const { sections } = arrangement;
  const first = sections[0];
  const last = sections.at(-1);
  if (!first || !last) return { fadeIn: 0, fadeOut: 0 };
  /** @param {number} id */
  const genome = (id) => requireGenome(genomes.get(id), `sketch ${id}'s genome`);
  const fadeIn = genome(first.sketchId).fadeIn;
  const fadeOut = genome(last.sketchId).fadeOut;
  const length = arrangementLength(arrangement);
  const scale = Math.min(1, length / (fadeIn + fadeOut || 1));
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

/**
 * The track's fade gain at one frame, at the frame's center, as `smooth` rises over the
 * fade-in and falls over the fade-out.
 * @param {number} frame counted from the track's first
 * @param {{ fadeIn: number, fadeOut: number, frames: number }} fades the fades' lengths and the
 *   track's, in frames
 */
export function trackFadeGain(frame, { fadeIn, fadeOut, frames }) {
  const rise = frame < fadeIn ? CURVES.smooth((frame + 0.5) / fadeIn) : 1;
  const left = frames - frame;
  const fall = left <= fadeOut ? CURVES.smooth((left - 0.5) / fadeOut) : 1;
  return rise * fall;
}

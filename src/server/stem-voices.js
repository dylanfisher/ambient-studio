// Which voices make up each of a track's stems (decision 0063): one stem per voice id across the
// track, holding every voice of every section that `stemsOf` assigns to that id.
/** @import { Genome } from "../engine/genome-schema.js" */
import { voiceOfInstance } from "../engine/morph.js";

/**
 * A section's genome, and the morph instances it holds (0064).
 * @typedef {{ genome: Genome, instances?: readonly string[] }} StemSection
 */

/**
 * The stem each voice of a section plays in: its own id, or for a morph's renamed instance the
 * id of the voice it plays (0064), mapped here and only here. A sketch's own voice whose id ends
 * in the morph's suffix keeps its own stem.
 * @param {StemSection} section
 * @returns {{ id: string, stem: string }[]}
 */
function stemsOf({ genome, instances = [] }) {
  return genome.voices.map(({ id }) => ({
    id,
    stem: instances.includes(id) ? voiceOfInstance(id) : id,
  }));
}

/**
 * Every stem of a track: each voice id any section plays, mapped by `stemsOf`, sorted.
 * @param {readonly StemSection[]} sections
 * @returns {string[]}
 */
export const stemIds = (sections) =>
  [...new Set(sections.flatMap((section) => stemsOf(section).map(({ stem }) => stem)))].sort();

/**
 * The ids of a section's voices that play in `stem`; none when the section doesn't play it.
 * @param {StemSection} section
 * @param {string} stem
 * @returns {string[]}
 */
export const stemVoices = (section, stem) =>
  stemsOf(section)
    .filter((voice) => voice.stem === stem)
    .map(({ id }) => id);

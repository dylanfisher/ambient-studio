// Which voices make up each of a track's stems (decision 0063): one stem per voice id across the
// track, holding every voice of every section that `stemOf` assigns to that id.
/** @import { Genome } from "../engine/genome-schema.js" */
import { voiceOfInstance } from "../engine/morph.js";

/**
 * The stem a voice plays in: its own id, or for a morph's renamed instance the id of the voice
 * it plays (0064), mapped here and only here.
 * @param {string} voiceId
 */
const stemOf = voiceOfInstance;

/**
 * Every stem of a track: each voice id any section plays, mapped by `stemOf`, sorted.
 * @param {readonly { genome: Genome }[]} sections
 * @returns {string[]}
 */
export const stemIds = (sections) =>
  [...new Set(sections.flatMap(({ genome }) => genome.voices.map(({ id }) => stemOf(id))))].sort();

/**
 * The ids of `genome`'s voices that play in `stem`; none when the section doesn't play it.
 * @param {Genome} genome
 * @param {string} stem
 * @returns {string[]}
 */
export const stemVoices = (genome, stem) =>
  genome.voices.map(({ id }) => id).filter((id) => stemOf(id) === stem);

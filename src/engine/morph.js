// The rules of a morph between two sections of a track that decide its samples (decision 0064).
// The rest of a morph is written into the morph's genome, which a track's manifest holds; these
// are the rules a genome can't hold. Changing one changes a track's samples and bumps the engine
// version.

/**
 * Seconds of the equal-power crossfade at a morph's end, from the morph's genome to the incoming
 * section's own: the morph moves for the transition's seconds less these. A track's manifest
 * names it as each morph's crossfade.
 */
export const MORPH_HANDOVER = 4;

/** The shortest morph, in seconds: as much moving as handing over. */
export const MORPH_LEAST = 2 * MORPH_HANDOVER;

/**
 * Added to an incoming voice's id when an outgoing voice holds it, so the two play as two
 * instances. The id is part of every PRNG key (decision 0003), so this decides the incoming
 * instance's events. An instance is renamed only beside the outgoing voice whose id it takes,
 * and a morph whose voices already hold an id ending in the suffix, or whose renamed id would
 * pass `VOICE_ID`'s 16 characters, falls back to a crossfade, so `voiceOfInstance` always tells
 * a listed instance's voice from its id.
 */
export const MORPH_SUFFIX = "--in";

/**
 * The voice id a morph's renamed instance plays, which is its stem's (decision 0063): its id
 * without `MORPH_SUFFIX`. Only for the ids a morph lists as its instances: a sketch's own voice
 * may end in the suffix too.
 * @param {string} id
 */
export const voiceOfInstance = (id) =>
  id.endsWith(MORPH_SUFFIX) ? id.slice(0, -MORPH_SUFFIX.length) : id;

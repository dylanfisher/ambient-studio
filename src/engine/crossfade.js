// The crossfade between two neighboring sections of a track (decision 0062). Two sketches are
// unrelated signals, so their powers add: an equal-power law keeps the overlap's loudness level,
// where a linear one would dip 3 dB in the middle. It is part of what a track's audio depends
// on, named in its manifest; changing it bumps the engine version.

/** The law's name, as a track's manifest records it. */
export const CROSSFADE_LAW = "equal-power";

/**
 * The gains of the outgoing and the incoming section at one frame of a crossfade, taken at the
 * frame's center so the two ends are symmetric: cos and sin of a quarter turn.
 * @param {number} frame counted from the crossfade's first
 * @param {number} frames the crossfade's length
 * @returns {{ fall: number, rise: number }}
 */
export function crossfadeGains(frame, frames) {
  const angle = (Math.PI / 2) * ((frame + 0.5) / frames);
  return { fall: Math.cos(angle), rise: Math.sin(angle) };
}

// How long a track plays (decision 0061): its sections' seconds less each transition's overlap.
/** @import { Arrangement } from "./arrangement-schema.js" */

/**
 * @param {Arrangement} arrangement a valid one
 * @returns {number} seconds
 */
export function arrangementLength({ sections, transitions }) {
  const played = sections.reduce((sum, { seconds }) => sum + seconds, 0);
  return transitions.reduce((sum, { seconds }) => sum - seconds, played);
}

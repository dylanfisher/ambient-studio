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

/**
 * Where each section starts on the track: where the one before starts, plus its seconds, less
 * their transition's overlap.
 * @param {Arrangement} arrangement a valid one
 * @returns {number[]} track seconds
 */
export function sectionStarts({ sections, transitions }) {
  let start = 0;
  return sections.map(({ seconds }, i) => {
    const at = start;
    start += seconds - (transitions[i]?.seconds ?? 0);
    return at;
  });
}

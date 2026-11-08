// A region's bounds on a reference file (decision 0050), checked by the server before it stores
// one and by the References page before it sends one, so both say the same thing.

/**
 * The parts of a region the owner sets, which the page sends and the server stores.
 * @typedef {object} RegionFields
 * @property {number} startSeconds
 * @property {number} endSeconds
 * @property {string} label
 * @property {string} note "" for none
 */

/**
 * The shortest and longest region, in seconds. The longest bounds what one decode holds in
 * memory: 5 minutes of 48 kHz stereo floats is 115 MB.
 */
export const REGION_SECONDS = Object.freeze({ min: 1, max: 300 });

/**
 * What is wrong with a region's bounds, in a sentence for the owner, or null when nothing is.
 * @param {number} startSeconds
 * @param {number} endSeconds
 * @param {number} durationSeconds the file's
 * @returns {string | null}
 */
export function regionProblem(startSeconds, endSeconds, durationSeconds) {
  if (!(Number.isFinite(startSeconds) && startSeconds >= 0)) {
    return "The start must be a time of 0 seconds or more.";
  }
  if (!Number.isFinite(endSeconds)) return "The end must be a time.";
  if (endSeconds <= startSeconds) return "The end must be after the start.";
  const length = endSeconds - startSeconds;
  if (length < REGION_SECONDS.min) {
    return `A region must be at least ${REGION_SECONDS.min} second long.`;
  }
  if (length > REGION_SECONDS.max) {
    return `A region can be at most ${REGION_SECONDS.max / 60} minutes long.`;
  }
  if (endSeconds > durationSeconds) {
    return `The end is past the end of the file, which is ${Math.round(durationSeconds * 100) / 100} seconds long.`;
  }
  return null;
}

// The scale a card's position on a direction, or its nearness to a region, is read on (decision
// 0056): 0 at the vibe's least excerpt and 1 at its most, so a number says where a sound sits
// among the ones already made for the brief. Raw projections and cosines in CLAP's space differ
// by a few hundredths and mean nothing on their own.

/** Excerpts a scale needs: with one, there is no least and most to read between. */
export const MIN_SCALE_EXCERPTS = 2;

/**
 * @typedef {object} Scale
 * @property {number} low the vibe's least excerpt's value
 * @property {number} high its most's, above `low`
 */

/**
 * The least and most of `values`, or null with fewer than `MIN_SCALE_EXCERPTS` values or when
 * they are all equal.
 * @param {readonly number[]} values one per excerpt
 * @returns {Scale | null}
 */
export function vibeScale(values) {
  if (!values.every(Number.isFinite)) throw new Error(`a scale's values must be finite: ${values}`);
  if (values.length < MIN_SCALE_EXCERPTS) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high > low ? { low, high } : null;
}

/**
 * Where `value` sits on the scale: 0 at its low, 1 at its high, and past either for a sound
 * beyond what the vibe has made.
 * @param {number} value
 * @param {Scale} scale
 * @returns {number}
 */
export const scaledPosition = (value, { low, high }) => (value - low) / (high - low);

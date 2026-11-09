// Where a value sits among others, as the place every description in words reads (decision
// 0085): a candidate's feature against the rest of its brief, its rank in its session, a search
// point's score in its run. Written from these thresholds, never by the model (as 0047).

/** At least this share of the others below (or above) is "nearly all"; at least `most`, "most". */
export const PLACE_SHARES = Object.freeze({ nearlyAll: 0.9, most: 0.7 });

/** The fewest others a feature is compared with: with fewer, one excerpt moves a share by 0.25. */
export const MIN_OTHERS = 4;

/**
 * The share of `others` below `value`, each one equal to it counting half.
 * @param {number} value
 * @param {readonly number[]} others
 * @returns {number} from 0 to 1
 */
export function shareBelow(value, others) {
  if (others.length === 0) throw new Error("a share below needs at least one other value");
  let below = 0;
  for (const other of others) below += other < value ? 1 : other === value ? 0.5 : 0;
  return below / others.length;
}

/**
 * The place a share below falls in: above or below most or nearly all of the others, or the
 * middle (both null).
 * @param {number} share from `shareBelow`
 * @returns {{ side: "above" | "below" | null, degree: "most" | "nearly all" | null }}
 */
export function placeOf(share) {
  const { nearlyAll, most } = PLACE_SHARES;
  if (share >= nearlyAll) return { side: "above", degree: "nearly all" };
  if (share >= most) return { side: "above", degree: "most" };
  // 1 - share, not share <= 1 - nearlyAll, which is 0.0999… in floating point.
  if (1 - share >= nearlyAll) return { side: "below", degree: "nearly all" };
  if (1 - share >= most) return { side: "below", degree: "most" };
  return { side: null, degree: null };
}

// The least a vibe needs before its taste model is tested or described (decision 0045): A/B
// ratings that aren't skips, a tie counted once, over enough sessions. Leave-one-session-out
// needs three sessions for every fold to train on more than one.

/** Below this a vibe reads "not enough data". */
export const PREFERENCE_MINIMUM = Object.freeze({ pairs: 40, sessions: 3 });

/**
 * How many more pairs and sessions a vibe needs, or null when it has enough.
 * @param {number} pairs A/B ratings that aren't skips, a tie counted once
 * @param {number} sessions the sessions those ratings came from
 * @returns {{ pairs: number, sessions: number } | null}
 */
export function shortfall(pairs, sessions) {
  const more = {
    pairs: Math.max(0, PREFERENCE_MINIMUM.pairs - pairs),
    sessions: Math.max(0, PREFERENCE_MINIMUM.sessions - sessions),
  };
  return more.pairs === 0 && more.sessions === 0 ? null : more;
}

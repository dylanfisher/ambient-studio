// How the session table shows where an excerpt sits in the ranking (decision 0046): its
// rank and the taste model's score, and why a wildcard sits above its rank. No DOM.

/** @param {number} n */
function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * @param {{ rank: number, score: number, wildcard: boolean }} place
 * @param {number} total the excerpts ranked
 * @returns {{ text: string, title: string, wildcard: string | null }} `wildcard` is the
 *   wildcard badge's title, null when it isn't one
 */
export function rankText({ rank, score, wildcard }, total) {
  return {
    text: `Taste #${rank} of ${total}, score ${score.toFixed(2)}`,
    title: `Your taste model ranks this excerpt ${ordinal(rank)} of ${total} in this session, at a score of ${score.toFixed(2)}. A higher score is more like what you chose before; the table lists candidates by it.`,
    wildcard: wildcard
      ? "A wildcard: your taste model ranks it in the bottom half, and it is listed higher up so you still hear it. One place in every eight goes to a wildcard."
      : null,
  };
}

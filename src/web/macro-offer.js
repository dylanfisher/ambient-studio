// The lock control's offer (decision 0035): a locked raw value still follows the macros, as the
// owner settled, so after a lock the card offers to lock the macros that move it too. The lock
// route names them; this leaves out the ones already locked. No DOM.
import { GENOME_KEY } from "../engine/genome-schema.js";

/** @param {readonly string[]} words */
const listed = (words) =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/**
 * @param {readonly string[]} macros the lock route's `macros`: the ones that move the value
 * @param {readonly { path: string }[]} locks the vibe's live locks
 * @returns {{ paths: string[], text: string } | null} the lock paths to offer and the sentence
 *   asking, or null when there is nothing to offer
 */
export function macroOffer(macros, locks) {
  const free = macros.filter(
    (macro) => !locks.some((lock) => lock.path === `${GENOME_KEY.macros}.${macro}`),
  );
  if (free.length === 0) return null;
  const one = free.length === 1;
  return {
    paths: free.map((macro) => `${GENOME_KEY.macros}.${macro}`),
    text: `A locked value still follows the macros, and ${listed(free)} ${one ? "moves" : "move"} this one. Lock ${one ? "it" : "them"} too, so it sounds the same?`,
  };
}

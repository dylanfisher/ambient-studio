// A reading cut to its token cap in a stated order (decision 0078): each of its items (a voice,
// a lineage step) is written at a level, 0 in full, and the cuts raise one item's level at a
// time until the lines fit.
import { estimateTokens } from "./prompt-tokens.js";

/**
 * @param {number} count how many items the reading has
 * @param {(levels: readonly number[]) => string[]} write the lines with each item at its level
 * @param {readonly (readonly [number, number])[]} cuts each an item and the level it is cut to,
 *   in the order they are made
 * @param {number} budgetTokens
 * @returns {string[]}
 */
export function fitReading(count, write, cuts, budgetTokens) {
  const levels = Array.from({ length: count }, () => 0);
  let lines = write(levels);
  for (const [item, level] of cuts) {
    if (estimateTokens(lines.join("\n")) <= budgetTokens) return lines;
    levels[item] = level;
    lines = write(levels);
  }
  const tokens = estimateTokens(lines.join("\n"));
  if (tokens > budgetTokens) {
    throw new Error(
      `the reading is about ${tokens} tokens with every cut made, over its ${budgetTokens}`,
    );
  }
  return lines;
}

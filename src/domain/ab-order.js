// Which side of an A/B choice is shown on the left (decision 0027). The server draws a seed per
// pair and stores it with the rating, so the order is reproducible from the row.
import { draw } from "../engine/prng.js";

/** Order seeds are integers in [0, AB_ORDER_SEEDS), the PRNG's whole key range. */
export const AB_ORDER_SEEDS = 2 ** 32;

/**
 * The key the draw is made under. It isn't a valid voice id, so it never shares a draw with a
 * render or with generation's sampling stream (decision 0003).
 */
const ORDER_ID = ":ab-order";

/**
 * @param {number} seed an integer in [0, AB_ORDER_SEEDS)
 * @returns {"a" | "b"} the side shown on the left
 */
export function abOrder(seed) {
  return draw(seed, ORDER_ID, 0, 0) < 0.5 ? "a" : "b";
}

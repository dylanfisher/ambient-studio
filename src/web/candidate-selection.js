// Which candidate the session view rates, and the clock its time taken runs on (decisions 0027,
// 0028 and 0032). No DOM: choosing a candidate never moves the focus, so a reload or a click
// never takes it from a note being typed.

/**
 * @template K
 * @typedef {object} Selection
 * @property {() => K | null} current
 * @property {(key: K) => void} choose the owner picked `key`, by playing it or by using one of
 *   its controls: it is selected and its clock starts, unless it already was
 * @property {() => void} restart starts the clock again, after a rating or the A/B view closing
 * @property {() => number} elapsedMs since the candidate was chosen or the clock restarted
 */

/**
 * @template K
 * @param {() => number} now a monotonic clock in milliseconds, `performance.now` on the page
 * @returns {Selection<K>}
 */
export function createSelection(now) {
  /** @type {K | null} */
  let selected = null;
  let since = now();
  return {
    current: () => selected,
    choose(key) {
      if (key === selected) return;
      selected = key;
      since = now();
    },
    restart() {
      since = now();
    },
    elapsedMs: () => now() - since,
  };
}

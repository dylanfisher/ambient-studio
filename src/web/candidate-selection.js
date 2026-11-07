// Which candidate the session view rates, and the clock its time taken runs on (decisions 0027
// and 0028). No DOM: the page asks whether a selection may move the focus, and it may only when
// the owner chose it and isn't typing, so a grid reload never turns a note into key presses.

/**
 * @template K
 * @typedef {object} Selection
 * @property {() => K | null} current
 * @property {(key: K, context: { inField: boolean }) => { focus: boolean }} choose the owner
 *   picked `key`: it is selected and its clock starts, unless it already was. Focus moves to it
 *   only when it is new and no form control has the focus.
 * @property {(from: K, to: K) => void} carry a reload replaced `from` with `to`; the selection
 *   and its clock follow, and the focus stays where it is
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
    choose(key, { inField }) {
      if (key === selected) return { focus: false };
      selected = key;
      since = now();
      return { focus: !inField };
    },
    carry(from, to) {
      if (selected === from) selected = to;
    },
    restart() {
      since = now();
    },
    elapsedMs: () => now() - since,
  };
}

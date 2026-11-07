// Which card of a revised pair the session page shows (decision 0036). The server picks one by
// the owner's rule; the page swaps to it, but never while the visible card's excerpt plays, so a
// listen isn't cut off, and once the owner picks a card with the pair's link, that pick stays.
// No DOM, so the rule is tested on its own.

/**
 * @typedef {object} PairSwap
 * @property {(firstTryId: number, wanted: number, playing: (id: number) => boolean) => number} show
 *   takes the server's pick for the pair named by its first try and returns the card to show:
 *   the pick, unless the visible card plays or the owner picked. Before a pair is first shown,
 *   its first try is the visible card.
 * @property {(firstTryId: number, id: number) => void} choose the owner picked `id`
 */

/** @returns {PairSwap} */
export function createPairSwap() {
  /** @type {Map<number, { visible: number, chosen: boolean }>} */
  const pairs = new Map();
  return {
    show(firstTryId, wanted, playing) {
      const known = pairs.get(firstTryId);
      const visible = known?.visible ?? firstTryId;
      if (known?.chosen || (visible !== wanted && playing(visible))) return visible;
      pairs.set(firstTryId, { visible: wanted, chosen: false });
      return wanted;
    },
    choose(firstTryId, id) {
      pairs.set(firstTryId, { visible: id, chosen: true });
    },
  };
}

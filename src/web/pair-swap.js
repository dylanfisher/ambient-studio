// Which card of a revised pair the session page shows (decision 0036). The server picks one by
// the owner's rule; the page swaps to it, but never while the visible card is held: its excerpt
// plays, it holds the focus, or it has a note or tags not yet sent. So a listen isn't cut off
// and a note being typed keeps its text and the focus. Once the owner picks a card with the
// pair's link, that pick stays. No DOM, so the rule is tested on its own.

/**
 * Whether the card of candidate `id` may not be hidden now.
 * @typedef {object} Held
 * @property {(id: number) => boolean} playing its excerpt plays
 * @property {(id: number) => boolean} editing it holds the focus, or text not yet sent
 */

/**
 * @typedef {object} PairSwap
 * @property {(firstTryId: number, wanted: number, held: Held) => number} show takes the server's
 *   pick for the pair named by its first try and returns the card to show: the pick, unless the
 *   visible card is held or the owner picked. Before a pair is first shown, its first try is the
 *   visible card.
 * @property {(firstTryId: number, id: number) => void} choose the owner picked `id`
 */

/** @returns {PairSwap} */
export function createPairSwap() {
  /** @type {Map<number, { visible: number, chosen: boolean }>} */
  const pairs = new Map();
  return {
    show(firstTryId, wanted, { playing, editing }) {
      const known = pairs.get(firstTryId);
      const visible = known?.visible ?? firstTryId;
      if (known?.chosen) return visible;
      if (visible !== wanted && (playing(visible) || editing(visible))) return visible;
      pairs.set(firstTryId, { visible: wanted, chosen: false });
      return wanted;
    },
    choose(firstTryId, id) {
      pairs.set(firstTryId, { visible: id, chosen: true });
    },
  };
}

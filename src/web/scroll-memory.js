// Where the session page was scrolled when the owner left it for Quick A/B or opened the A/B
// view, so the return lands on the same row (decision 0049). The page passes `sessionStorage`,
// which is per tab and per viewer: a convenience, not data. No DOM, so a test passes a fake.

/** @typedef {Pick<Storage, "getItem" | "setItem" | "removeItem">} ScrollStorage */

/**
 * @param {ScrollStorage} storage
 * @param {string} key one per session page
 */
export function scrollMemory(storage, key) {
  return {
    /** @param {number} y the page's `scrollY` */
    save(y) {
      storage.setItem(key, String(Math.round(y)));
    },
    /**
     * The saved position, removed so a later load starts fresh, or null when none was saved.
     * @returns {number | null}
     */
    take() {
      const text = storage.getItem(key);
      if (text === null) return null;
      storage.removeItem(key);
      const y = Number(text);
      if (text.trim() === "" || !Number.isFinite(y)) {
        throw new Error(`the saved scroll for ${key} is ${JSON.stringify(text)}, not a position`);
      }
      return y;
    },
  };
}

// The share of an excerpt the owner played at least once (decision 0027): the union of the
// intervals played, over the excerpt's duration. No DOM here; the page calls it from the audio
// element's events (decision 0028).

/**
 * @typedef {object} PlayedTracker
 * @property {(time: number) => void} start playback began at `time` (`playing`, or `seeked`
 *   while playing)
 * @property {(time: number) => void} reach playback is at `time` (`timeupdate`); ignored while
 *   stopped, and a jump backwards starts a new interval
 * @property {(time?: number) => void} stop playback stopped at `time` (`pause`, `ended`), or
 *   with no time where it was last reached (`seeking`, whose currentTime is already the new
 *   position)
 * @property {() => number} fraction from 0 to 1
 */

/**
 * @param {number} duration the excerpt's length in seconds
 * @returns {PlayedTracker}
 */
export function createPlayedTracker(duration) {
  if (!(duration > 0 && Number.isFinite(duration))) {
    throw new Error(`duration must be a positive number of seconds, got ${duration}`);
  }
  /** @type {[number, number][]} */
  const closed = [];
  /** @type {{ from: number, to: number } | null} */
  let open = null;

  const close = () => {
    if (open) closed.push([open.from, open.to]);
    open = null;
  };

  return {
    start(time) {
      close();
      open = { from: time, to: time };
    },
    reach(time) {
      if (!open) return;
      if (time < open.to) {
        close();
        open = { from: time, to: time };
      } else {
        open.to = time;
      }
    },
    stop(time) {
      if (open && time !== undefined && time > open.to) open.to = time;
      close();
    },
    fraction() {
      /** @type {[number, number][]} */
      const all = open ? [...closed, [open.from, open.to]] : [...closed];
      const clipped = all
        .map(
          ([from, to]) =>
            /** @type {[number, number]} */ ([Math.max(0, from), Math.min(duration, to)]),
        )
        .filter(([from, to]) => to > from)
        .sort(([a], [b]) => a - b);
      let played = 0;
      let reached = 0;
      for (const [from, to] of clipped) {
        if (to > reached) played += to - Math.max(from, reached);
        reached = Math.max(reached, to);
      }
      return Math.min(1, played / duration);
    },
  };
}

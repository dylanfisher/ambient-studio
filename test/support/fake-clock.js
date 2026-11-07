// A clock the test moves by hand, injected where the omlx queue would take the real one
// (decision 0022), so gaps, backoff and timeouts run without waiting on real time.

/**
 * @typedef {object} PendingTimer
 * @property {number} at the fake time it fires
 * @property {number} delay the delay it was set with
 */

/**
 * @typedef {object} FakeClock
 * @property {() => number} now fake milliseconds, starting at 0
 * @property {(callback: () => void, ms: number) => number} setTimeout
 * @property {(handle: unknown) => void} clearTimeout
 * @property {(ms: number) => void} advance moves time forward, firing each timer due on the way
 *   in the order it falls due
 * @property {(predicate: (pending: PendingTimer[]) => boolean) => Promise<void>} waitFor resolves
 *   once `predicate` holds for the pending timers, checked now and after every set or clear
 * @property {(delay: number) => Promise<void>} waitForTimer resolves once a timer set with
 *   `delay` is pending
 */

/** @returns {FakeClock} */
export function fakeClock() {
  let time = 0;
  let nextHandle = 1;
  /** @type {Map<number, PendingTimer & { callback: () => void }>} */
  const timers = new Map();
  /** @type {{ predicate: (pending: PendingTimer[]) => boolean, resolve: () => void }[]} */
  let waiters = [];

  const pending = () => [...timers.values()].map(({ at, delay }) => ({ at, delay }));
  const check = () => {
    const list = pending();
    const met = waiters.filter((waiter) => waiter.predicate(list));
    waiters = waiters.filter((waiter) => !met.includes(waiter));
    for (const waiter of met) waiter.resolve();
  };

  /** @type {FakeClock["waitFor"]} */
  const waitFor = (predicate) =>
    new Promise((resolve) => {
      waiters.push({ predicate, resolve });
      check();
    });

  return {
    now: () => time,
    setTimeout(callback, ms) {
      const handle = nextHandle++;
      timers.set(handle, { at: time + ms, delay: ms, callback });
      check();
      return handle;
    },
    clearTimeout(handle) {
      if (typeof handle === "number" && timers.delete(handle)) check();
    },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
        if (due === undefined) break;
        const [handle, timer] = due;
        timers.delete(handle);
        time = timer.at;
        timer.callback();
      }
      time = end;
      check();
    },
    waitFor,
    waitForTimer: (delay) => waitFor((list) => list.some((timer) => timer.delay === delay)),
  };
}

/**
 * Runs `work` to its end, moving `clock` past each `gap` the omlx queue waits between requests.
 * @template T
 * @param {FakeClock} clock
 * @param {number} gap the queue's `minGapMs`
 * @param {Promise<T>} work
 * @returns {Promise<T>}
 */
export async function driveGaps(clock, gap, work) {
  let done = false;
  const settled = work.finally(() => {
    done = true;
  });
  while (!done) {
    const gapWaiting = await Promise.race([
      settled.then(
        () => false,
        () => false,
      ),
      clock.waitForTimer(gap).then(() => true),
    ]);
    if (gapWaiting) clock.advance(gap);
  }
  return settled;
}

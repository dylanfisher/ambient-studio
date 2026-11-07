// An action that does nothing while its last run is pending, so a double press or a held key
// posts a rating, a pair or a revision once (decision 0028).

/**
 * @param {() => unknown} action
 * @returns {() => Promise<void>} resolves when this call's run ends, at once for a call ignored
 *   because one is pending; rejects with the run's error
 */
export function oneAtATime(action) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await action();
    } finally {
      running = false;
    }
  };
}

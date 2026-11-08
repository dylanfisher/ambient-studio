// A reload that runs one at a time and never answers out of order (decision 0057): a call while
// one runs asks for one more run after it, however many calls came, so the page ends on what
// the server holds after the last call, and a slow read can't land after a newer one. The map
// reads its archive this way, since each read can ask the sidecar to score every excerpt.

/**
 * @param {() => Promise<void>} load
 * @returns {() => Promise<void>} resolves once a run that started after this call has ended
 */
export function latestOnly(load) {
  /** @type {Promise<void> | null} */
  let running = null;
  let again = false;
  return () => {
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await load();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

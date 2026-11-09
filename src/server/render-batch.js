// Independent excerpt renders of one job's batch, a few at a time (decision 0076). The native
// render thread does a render's work and the event loop sits idle for most of it, so renders in
// one process overlap; no worker threads, and still one job at a time (0026).

/**
 * Renders a batch runs at once at most. The knee of the bench in 0076, on mbp2021 under
 * `nice -n 10`, kept low because omlx serves a live site from the same machine.
 */
export const RENDER_CONCURRENCY = 3;

/**
 * Runs `work` on each item, at most `limit` at once, and returns the results in the items'
 * order. A cancel or a failure starts no more items and waits for those in flight, so nothing
 * of the batch is still writing once this settles. It then throws the signal's reason on a
 * cancel, the error when one item failed, or an `AggregateError` of all of them when several
 * did.
 * @template T, R
 * @param {readonly T[]} items
 * @param {(item: T, index: number) => Promise<R>} work
 * @param {object} options
 * @param {AbortSignal} options.signal checked before each item starts
 * @param {number} [options.limit] `RENDER_CONCURRENCY` when omitted
 * @param {(done: number) => void} [options.progress] called with 0 first and after each item
 *   finishes, with how many have
 * @returns {Promise<R[]>}
 */
export async function renderBatch(
  items,
  work,
  { signal, limit = RENDER_CONCURRENCY, progress = () => {} },
) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`a render batch runs at least 1 item at once, not ${limit}`);
  }
  /** @type {R[]} */
  const results = new Array(items.length);
  /** @type {unknown[]} */
  const errors = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && errors.length === 0 && !signal.aborted) {
      const index = next++;
      try {
        results[index] = await work(/** @type {T} */ (items[index]), index);
      } catch (error) {
        errors.push(error);
        return;
      }
      progress(++done);
    }
  };
  progress(done);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  signal.throwIfAborted();
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    const messages = errors.map((error) => (error instanceof Error ? error.message : error));
    throw new AggregateError(
      errors,
      `${errors.length} renders of a batch failed: ${messages.join("; ")}`,
    );
  }
  return results;
}

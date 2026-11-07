// The one offline render sequence, which the export and the tests share: an
// OfflineAudioContext sized by `renderPlan`, `render()` to schedule, then `trimToResult`.
// src/engine can't import node-web-audio-api, so the context is built here.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { RenderResult } from "../engine/render-plan.js" */
/** @import { RenderOptions } from "../engine/render.js" */
import { OfflineAudioContext } from "node-web-audio-api";
import { render } from "../engine/render.js";
import { renderPlan, trimToResult } from "../engine/render-plan.js";

/** Real-time wait in ms between scheduling a render and starting it, one entry per attempt. */
const SETTLE_MS = [10, 50, 200, 500, 1000, 2000];
const MAX_ATTEMPTS = SETTLE_MS.length;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The library registers a `suspend` when its future is first polled, on another thread, and
 * fails it with this error once `startRendering()` has taken the renderer (decision 0002). Under
 * load the two race, so yielding to the event loop between them does not prevent it.
 * @param {unknown} error
 * @returns {boolean}
 */
function isSuspendRace(error) {
  return (
    error instanceof Error &&
    error.name === "InvalidStateError" &&
    error.message === "Error in async function"
  );
}

/**
 * Runs `attemptRender`, which builds a fresh context each time, again when it fails with the
 * suspend race: a failed attempt never yields samples, so a retry renders the same bytes. Any
 * other error, and the race on the last attempt, is thrown as it came. Each retry is reported.
 * `attemptRender` gets `settle`, which waits the attempt's share of `SETTLE_MS`; awaiting it
 * between scheduling suspends and `startRendering()` gives the library's runtime time to
 * register them, and the wait grows on each retry.
 * @template T
 * @param {(settle: () => Promise<void>) => Promise<T>} attemptRender
 * @param {(ms: number) => Promise<void>} [wait] replaces the real-time wait, for tests
 * @returns {Promise<T>}
 */
export async function retryOnSuspendRace(attemptRender, wait = sleep) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptRender(() => wait(SETTLE_MS[attempt - 1] ?? 0));
    } catch (error) {
      if (!isSuspendRace(error) || attempt === MAX_ATTEMPTS) throw error;
      console.warn(`suspend race, attempt ${attempt} of ${MAX_ATTEMPTS}: ${error}`);
    }
  }
}

/**
 * @param {Genome} genome
 * @param {RenderOptions} options
 * @param {(ctx: OfflineAudioContext) => void} [prepare] changes the context before `render()`;
 *   tests use it to add nodes or wrap `suspend`
 * @param {(ms: number) => Promise<void>} [wait] replaces the real-time wait before
 *   `startRendering()`, for tests
 * @returns {Promise<RenderResult>}
 */
export function renderOffline(genome, options, prepare, wait) {
  const { duration, offset = 0 } = options;
  const plan = renderPlan(genome, { duration, offset });
  return retryOnSuspendRace(async (settle) => {
    const ctx = new OfflineAudioContext({
      numberOfChannels: plan.channels,
      length: plan.length,
      sampleRate: plan.sampleRate,
    });
    prepare?.(ctx);
    // `render()` registers its suspends before rendering starts. The two are awaited together,
    // so a window that throws rejects here instead of going unhandled.
    const scheduled = render(genome, ctx, options);
    await settle();
    const [buffer] = await Promise.all([ctx.startRendering(), scheduled]);
    return trimToResult(buffer, plan);
  }, wait);
}

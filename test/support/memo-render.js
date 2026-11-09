// Renders each distinct window once per test file, for tests that run jobs whose excerpts are
// the same few genomes at the same seeds and check bookkeeping, not audio. A first call runs the
// real `renderOffline`; a repeat gets a copy of its result, so the rest of the pipeline
// (normalize, features, the MP3) still runs on real samples.
//
//   vi.mock("../../src/server/render-offline.js", async (original) =>
//     (await import("../support/memo-render.js")).memoRenderOffline(await original()));

/**
 * @param {typeof import("../../src/server/render-offline.js")} actual
 * @returns {typeof actual}
 */
export function memoRenderOffline(actual) {
  /** @type {Map<string, Promise<Awaited<ReturnType<typeof actual.renderOffline>>>>} */
  const made = new Map();
  return {
    ...actual,
    async renderOffline(genome, options, prepare, wait) {
      const { seed, duration, offset = 0, samples } = options;
      if (prepare || wait || (samples && Object.keys(samples).length > 0)) {
        return actual.renderOffline(genome, options, prepare, wait);
      }
      const key = JSON.stringify([genome, seed, duration, offset]);
      let result = made.get(key);
      if (!result) {
        result = actual.renderOffline(genome, options);
        made.set(key, result);
      }
      const rendered = await result;
      // A copy per caller, so no one's in-place change reaches the next.
      return { ...rendered, channels: rendered.channels.map((channel) => channel.slice()) };
    },
  };
}

// Records the buffer sources a render starts, for tests of voices that play a buffer a window.

/**
 * @typedef {object} StartedSource
 * @property {number} frame the context frame it starts on
 * @property {number} frames its buffer's length
 */

/**
 * Makes `ctx` record every buffer source started on it, into the returned list.
 * @param {BaseAudioContext} ctx
 * @returns {StartedSource[]}
 */
export function recordSources(ctx) {
  /** @type {StartedSource[]} */
  const started = [];
  const create = ctx.createBufferSource.bind(ctx);
  Object.defineProperty(ctx, "createBufferSource", {
    value: () => {
      const source = create();
      const start = source.start.bind(source);
      source.start = (when = 0, ...rest) => {
        started.push({
          frame: Math.round(when * ctx.sampleRate),
          frames: source.buffer?.length ?? 0,
        });
        start(when, ...rest);
      };
      return source;
    },
  });
  return started;
}

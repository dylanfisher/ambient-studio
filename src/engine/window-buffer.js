// Plays a window's sound computed in JS, for voices that compute their sound from timeline
// frames and play one buffer source a window (decision 0010): the buffers abut, so no two
// are nonzero into the same node at once.

/**
 * Plays `channels` from one buffer source into `into`, starting on timeline frame `first`.
 * @param {{ ctx: BaseAudioContext; channels: readonly Float32Array<ArrayBuffer>[];
 *   first: number; startFrame: number; startTime: number; into: AudioNode }} window
 *   `startFrame` is the render's first timeline frame, and `startTime` its context time
 */
export function playWindowBuffer({ ctx, channels, first, startFrame, startTime, into }) {
  const rate = ctx.sampleRate;
  const frames = /** @type {Float32Array} */ (channels[0]).length;
  const buffer = ctx.createBuffer(channels.length, frames, rate);
  for (const [c, data] of channels.entries()) buffer.copyToChannel(data, c);
  const player = ctx.createBufferSource();
  player.buffer = buffer;
  player.connect(into);
  // Each window's buffer starts on the frame where the last one ended.
  player.start(startTime + (first - startFrame) / rate);
}

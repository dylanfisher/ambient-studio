/**
 * The frame count of `channels`, throwing unless there is at least one channel and all have
 * the same length, as an encoder that interleaves them needs.
 * @param {Float32Array[]} channels
 * @param {string} caller named in the error for no channels
 * @returns {number}
 */
export function channelFrames(channels, caller) {
  const first = channels[0];
  if (!first) throw new Error(`${caller} needs at least one channel`);
  const frames = first.length;
  for (const [c, channel] of channels.entries()) {
    if (channel.length !== frames) {
      throw new Error(`channel ${c} has length ${channel.length}, channel 0 has ${frames}`);
    }
  }
  return frames;
}

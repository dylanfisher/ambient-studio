import { createLimiter } from "./limiter.js";

/**
 * Writes `input` times `gain` into `output`, with a look-ahead limiter holding every channel's
 * 4x-interpolated peak at or under `threshold`: `createLimiter` over the whole input as one
 * chunk.
 * @param {Float32Array[]} input channels of equal length
 * @param {Float32Array[]} output as many channels as `input`, of the same length
 * @param {number} gain linear
 * @param {number} threshold linear
 * @param {number} sampleRate
 */
export function limitTruePeak(input, output, gain, threshold, sampleRate) {
  const limiter = createLimiter(gain, threshold, sampleRate);
  const head = limiter.push(input, output);
  const written = head[0]?.length ?? 0;
  limiter.finish(output.map((channel) => channel.subarray(written)));
}

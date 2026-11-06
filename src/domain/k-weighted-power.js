import { requireMeterSampleRate } from "./meter-sample-rate.js";

/** Frames in one sub-block, 10 ms at 48 kHz. Every BS.1770 window is a whole number of them. */
const SUB_BLOCK_FRAMES = 480;

// BS.1770-4 Table 1: stage 1, the shelf that models the head.
const B0 = 1.53512485958697;
const B1 = -2.69169618940638;
const B2 = 1.19839281085285;
const A1 = -1.69065929318241;
const A2 = 0.73248077421585;
// BS.1770-4 Table 2: stage 2, the RLB high-pass, with b = [1, -2, 1].
const C1 = -1.99004745483398;
const C2 = 0.99007225036621;

/**
 * The K-weighted power of consecutive 10 ms sub-blocks: for each, the sum over channels of the
 * mean square of the K-weighted signal. Mono and stereo channels all weigh 1.0 (BS.1770-4
 * Table 3). Trailing frames that don't fill a sub-block are left out, since no complete window
 * can include them.
 * @param {Float32Array[]} channels one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @returns {Float64Array}
 */
export function kWeightedPower(channels, sampleRate) {
  requireMeterSampleRate(sampleRate);
  if (channels.length < 1 || channels.length > 2) {
    // Weights beyond stereo depend on speaker position, which an array of channels doesn't say.
    throw new Error(`the loudness meter takes 1 or 2 channels, got ${channels.length}`);
  }
  const length = channels[0]?.length ?? 0;
  for (const channel of channels) {
    if (channel.length !== length) {
      throw new Error(`channel length ${channel.length} differs from ${length}`);
    }
  }
  const power = new Float64Array(Math.floor(length / SUB_BLOCK_FRAMES));
  for (const channel of channels) addChannelPower(channel, power);
  for (let k = 0; k < power.length; k++) power[k] = (power[k] ?? 0) / SUB_BLOCK_FRAMES;
  return power;
}

/**
 * Runs both K-weighting biquads over one channel in float64 (direct form I) and adds the
 * squared output, summed per sub-block, into `power`.
 * @param {Float32Array} x
 * @param {Float64Array} power
 */
function addChannelPower(x, power) {
  let x1 = 0;
  let x2 = 0;
  let m1 = 0;
  let m2 = 0;
  let y1 = 0;
  let y2 = 0;
  let n = 0;
  for (let k = 0; k < power.length; k++) {
    let sum = 0;
    for (const stop = n + SUB_BLOCK_FRAMES; n < stop; n++) {
      const x0 = x[n] ?? 0;
      const m0 = B0 * x0 + B1 * x1 + B2 * x2 - A1 * m1 - A2 * m2;
      const y0 = m0 - 2 * m1 + m2 - C1 * y1 - C2 * y2;
      x2 = x1;
      x1 = x0;
      m2 = m1;
      m1 = m0;
      y2 = y1;
      y1 = y0;
      sum += y0 * y0;
    }
    power[k] = (power[k] ?? 0) + sum;
  }
}

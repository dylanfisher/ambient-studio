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

// A channel's carried state: the biquads' last two inputs, middles and outputs, then the sum
// of squares over the unfinished sub-block.
const STATE_SIZE = 7;

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
  return createKWeightedPower(sampleRate).push(channels);
}

/**
 * `kWeightedPower` over a stream read in chunks of any length, with the same bits (0060): each
 * channel carries its filter state and its sum over the unfinished sub-block between chunks.
 * @param {number} sampleRate must be 48000
 * @returns {{ push: (channels: Float32Array[]) => Float64Array }} `push` takes the next chunk
 *   of one or two channels of equal length, the count fixed by the first push, and returns
 *   the power of each sub-block the chunk completes
 */
export function createKWeightedPower(sampleRate) {
  requireMeterSampleRate(sampleRate);
  /** @type {Float64Array[] | undefined} */
  let states;
  // Frames of the unfinished sub-block already in the carried sums.
  let filled = 0;
  return {
    push(channels) {
      if (channels.length < 1 || channels.length > 2) {
        // Weights beyond stereo depend on speaker position, which an array of channels doesn't
        // say.
        throw new Error(`the loudness meter takes 1 or 2 channels, got ${channels.length}`);
      }
      const length = channels[0]?.length ?? 0;
      for (const channel of channels) {
        if (channel.length !== length) {
          throw new Error(`channel length ${channel.length} differs from ${length}`);
        }
      }
      states ??= channels.map(() => new Float64Array(STATE_SIZE));
      if (channels.length !== states.length) {
        throw new Error(
          `the loudness meter was given ${states.length} channels, then ${channels.length}`,
        );
      }
      const power = new Float64Array(Math.floor((filled + length) / SUB_BLOCK_FRAMES));
      channels.forEach((channel, c) => {
        addChannelPower(channel, /** @type {Float64Array} */ (states?.[c]), filled, power);
      });
      for (let k = 0; k < power.length; k++) power[k] = (power[k] ?? 0) / SUB_BLOCK_FRAMES;
      filled = (filled + length) % SUB_BLOCK_FRAMES;
      return power;
    },
  };
}

/**
 * Runs both K-weighting biquads over one channel in float64 (direct form I) and adds the
 * squared output, summed per sub-block, into `power`. The frames after the last sub-block
 * `x` completes stay in the carried sum.
 * @param {Float32Array} x
 * @param {Float64Array} state read and written back
 * @param {number} filled frames of the first sub-block already in the carried sum
 * @param {Float64Array} power one element for each sub-block `x` completes
 */
function addChannelPower(x, state, filled, power) {
  let x1 = state[0] ?? 0;
  let x2 = state[1] ?? 0;
  let m1 = state[2] ?? 0;
  let m2 = state[3] ?? 0;
  let y1 = state[4] ?? 0;
  let y2 = state[5] ?? 0;
  let sum = state[6] ?? 0;
  let n = 0;
  let stop = SUB_BLOCK_FRAMES - filled;
  for (let k = 0; k <= power.length; k++) {
    if (k === power.length) stop = x.length;
    for (; n < stop; n++) {
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
    if (k < power.length) {
      power[k] = (power[k] ?? 0) + sum;
      sum = 0;
      stop += SUB_BLOCK_FRAMES;
    }
  }
  state.set([x1, x2, m1, m2, y1, y2, sum]);
}

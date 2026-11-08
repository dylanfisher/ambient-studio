import { carryHistory, INTERPOLATION_SPAN, interpolatedPeaks } from "./interpolated-peaks.js";
import { requireMeterSampleRate } from "./meter-sample-rate.js";

const BLOCK = 4096;
const EMPTY = new Float32Array(0);

/**
 * @typedef {object} TruePeakMeter
 * @property {(channels: Float32Array[]) => void} push the next chunk of every channel; the
 *   channel count is fixed by the first push
 * @property {() => number} truePeak the true peak of everything pushed, in dBTP; `-Infinity`
 *   for silence. Reading it doesn't end the stream.
 */

/**
 * BS.1770-4 true peak over a stream read in chunks of any length, giving the bits `truePeak`
 * gives for the whole stream (0060). Each channel keeps the filter's last 11 input samples
 * between chunks.
 * @param {number} sampleRate must be 48000
 * @returns {TruePeakMeter}
 */
export function createTruePeakMeter(sampleRate) {
  requireMeterSampleRate(sampleRate);
  const scratch = new Float64Array(BLOCK);
  /** @type {Float32Array[] | undefined} */
  let histories;
  let peak = 0;
  return {
    push(channels) {
      histories ??= channels.map(() => new Float32Array(INTERPOLATION_SPAN));
      if (channels.length !== histories.length) {
        throw new Error(
          `the true-peak meter was given ${histories.length} channels, then ${channels.length}`,
        );
      }
      channels.forEach((channel, c) => {
        const history = /** @type {Float32Array} */ (histories?.[c]);
        for (let start = 0; start < channel.length; start += BLOCK) {
          const end = Math.min(channel.length, start + BLOCK);
          peak = Math.max(peak, interpolatedPeaks(channel, start, end, scratch, history));
        }
        carryHistory(history, channel);
      });
    },
    truePeak() {
      let last = peak;
      // Outputs run 11 samples past the end of the input, so a peak in the final samples counts.
      for (const history of histories ?? []) {
        last = Math.max(last, interpolatedPeaks(EMPTY, 0, INTERPOLATION_SPAN, scratch, history));
      }
      return 20 * Math.log10(last);
    },
  };
}

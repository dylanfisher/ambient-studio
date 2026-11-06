import { interpolatedPeaks } from "./interpolated-peaks.js";
import { requireMeterSampleRate } from "./meter-sample-rate.js";

const BLOCK = 4096;

/**
 * BS.1770-4 true-peak level: the largest absolute value of any channel after 4x oversampling
 * with the standard's interpolation filter.
 * @param {Float32Array[]} channels any number of channels
 * @param {number} sampleRate must be 48000
 * @returns {number} dBTP; `-Infinity` for silence
 */
export function truePeak(channels, sampleRate) {
  requireMeterSampleRate(sampleRate);
  const scratch = new Float64Array(BLOCK);
  let peak = 0;
  for (const channel of channels) {
    // Outputs run 11 samples past the end of the input, so a peak in the final samples counts.
    const end = channel.length + 11;
    for (let start = 0; start < end; start += BLOCK) {
      peak = Math.max(
        peak,
        interpolatedPeaks(channel, start, Math.min(end, start + BLOCK), scratch),
      );
    }
  }
  return 20 * Math.log10(peak);
}

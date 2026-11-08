import { createTruePeakMeter } from "./true-peak-meter.js";

/**
 * BS.1770-4 true-peak level: the largest absolute value of any channel after 4x oversampling
 * with the standard's interpolation filter.
 * @param {Float32Array[]} channels any number of channels
 * @param {number} sampleRate must be 48000
 * @returns {number} dBTP; `-Infinity` for silence
 */
export function truePeak(channels, sampleRate) {
  const meter = createTruePeakMeter(sampleRate);
  meter.push(channels);
  return meter.truePeak();
}

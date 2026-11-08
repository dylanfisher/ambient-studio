import { createLoudnessMeter } from "./loudness-meter.js";

/**
 * BS.1770-4 gated integrated loudness: 400 ms blocks at 75% overlap, the -70 LUFS absolute
 * gate, then the -10 LU relative gate.
 * @param {Float32Array[]} channels one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @returns {number} LUFS; `-Infinity` when no block is above the absolute gate, including
 *   silence and input shorter than 400 ms
 */
export function integratedLoudness(channels, sampleRate) {
  const meter = createLoudnessMeter(sampleRate);
  meter.push(channels);
  return meter.integratedLoudness();
}

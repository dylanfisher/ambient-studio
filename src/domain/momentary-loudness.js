import { kWeightedPower } from "./k-weighted-power.js";
import { powerToLufs } from "./power-to-lufs.js";
import { windowPowers } from "./window-powers.js";

/**
 * Momentary loudness (EBU Tech 3341): ungated loudness of 400 ms windows every 10 ms. Element
 * j is the window that starts at j * 10 ms; input shorter than 400 ms gives an empty series.
 * @param {Float32Array[]} channels one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @returns {Float64Array} LUFS per window
 */
export function momentaryLoudness(channels, sampleRate) {
  return windowPowers(kWeightedPower(channels, sampleRate), 40, 1).map(powerToLufs);
}

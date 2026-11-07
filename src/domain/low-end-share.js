import { forEachMagnitudeFrame, SILENT_FRAME_POWER } from "./magnitude-frames.js";

// The frames of the spectral centroid (decision 0023): at 48 kHz the bins are 23.4 Hz apart, so
// the bins under the cutoff are 0 to 6, up to 140.6 Hz.
const FRAME = 2048;
const HOP = 1024;
const CUTOFF_HZ = 150;

/**
 * The share of the spectral power in bins under 150 Hz, summed over the frames that aren't
 * silent (decision 0033).
 * @param {Float32Array[]} channels one or more channels of equal length, mixed to mono
 * @param {number} sampleRate
 * @returns {number | null} from 0 to 1; null when every frame is silent
 */
export function lowEndShare(channels, sampleRate) {
  const lowBins = Math.ceil((CUTOFF_HZ * FRAME) / sampleRate);
  let low = 0;
  let total = 0;
  forEachMagnitudeFrame(channels, FRAME, HOP, (magnitudes, power) => {
    if (power < SILENT_FRAME_POWER) return;
    for (const [k, magnitude] of magnitudes.entries()) {
      const binPower = magnitude * magnitude;
      total += binPower;
      if (k < lowBins) low += binPower;
    }
  });
  return total === 0 ? null : low / total;
}

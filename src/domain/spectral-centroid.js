import { forEachMagnitudeFrame, SILENT_FRAME_POWER } from "./magnitude-frames.js";

// 2048 samples is 43 ms at 48 kHz, with bins 23 Hz apart (decision 0023).
const FRAME = 2048;
const HOP = 1024;

/**
 * The magnitude-weighted mean frequency of each frame, summarized over the frames that aren't
 * silent.
 * @param {Float32Array[]} channels one or more channels of equal length, mixed to mono
 * @param {number} sampleRate
 * @returns {{ mean: number | null, spread: number | null }} Hz: the mean of the frames'
 *   centroids and their standard deviation; null when every frame is silent
 */
export function spectralCentroid(channels, sampleRate) {
  const binHz = sampleRate / FRAME;
  /** @type {number[]} */
  const centroids = [];
  forEachMagnitudeFrame(channels, FRAME, HOP, (magnitudes, power) => {
    if (power < SILENT_FRAME_POWER) return;
    let weighted = 0;
    let total = 0;
    for (const [k, magnitude] of magnitudes.entries()) {
      weighted += k * binHz * magnitude;
      total += magnitude;
    }
    centroids.push(weighted / total);
  });
  if (centroids.length === 0) return { mean: null, spread: null };
  const mean = centroids.reduce((a, c) => a + c, 0) / centroids.length;
  const variance = centroids.reduce((a, c) => a + (c - mean) ** 2, 0) / centroids.length;
  return { mean, spread: Math.sqrt(variance) };
}

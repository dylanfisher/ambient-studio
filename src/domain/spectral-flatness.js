import { forEachMagnitudeFrame, SILENT_FRAME_POWER } from "./magnitude-frames.js";

// The frames of the spectral centroid (decision 0023).
const FRAME = 2048;
const HOP = 1024;
/**
 * The band the flatness is read over, in Hz. Bin 0 is left out because DC isn't sound. Bins
 * over 16 kHz are left out because a recording made at 44.1 kHz has none over 22.05 kHz, and
 * those empty bins would read as a tone.
 */
const LOWEST_HZ = 20;
const HIGHEST_HZ = 16000;

/**
 * The mean over frames that aren't silent of each frame's spectral flatness: the geometric mean
 * of its magnitudes over their arithmetic mean, from 20 Hz to 16 kHz (decision 0033). A pure
 * tone reads near 0; white noise reads about 0.85, the ratio for magnitudes that scatter as a
 * Rayleigh distribution, which a single frame of noise does.
 * @param {Float32Array[]} channels one or more channels of equal length, mixed to mono
 * @param {number} sampleRate
 * @returns {number | null} from 0 to 1; null when every frame is silent
 */
export function spectralFlatness(channels, sampleRate) {
  const first = Math.ceil((LOWEST_HZ * FRAME) / sampleRate);
  const last = Math.floor((HIGHEST_HZ * FRAME) / sampleRate);
  if (last > FRAME / 2) {
    throw new Error(
      `spectral flatness reads up to ${HIGHEST_HZ} Hz, over the Nyquist of ${sampleRate} Hz`,
    );
  }
  const bins = last - first + 1;
  let sum = 0;
  let frames = 0;
  forEachMagnitudeFrame(channels, FRAME, HOP, (magnitudes, power) => {
    if (power < SILENT_FRAME_POWER) return;
    let logs = 0;
    let total = 0;
    for (let k = first; k <= last; k++) {
      const magnitude = /** @type {number} */ (magnitudes[k]);
      logs += Math.log(magnitude);
      total += magnitude;
    }
    // A bin of exactly 0 makes `logs` -Infinity and the frame's flatness 0, which it is.
    sum += Math.exp(logs / bins) / (total / bins);
    frames++;
  });
  return frames === 0 ? null : sum / frames;
}

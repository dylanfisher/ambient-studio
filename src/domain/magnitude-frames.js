import { fft } from "./fft.js";

/**
 * Frames whose mean-square level is under this (-70 dBFS) count as silent: spectral features
 * skip them, since a spectrum of rounding noise has a centroid but says nothing about the sound.
 */
export const SILENT_FRAME_POWER = 1e-7;

/**
 * Calls `visit` with the magnitude spectrum of each Hann-windowed frame of the channels' mean,
 * from the first sample, `hop` samples apart, complete frames only. The spectrum is bins 0 to
 * `size / 2` in one buffer that is reused, so `visit` copies what it keeps.
 * @param {Float32Array[]} channels one or more channels of equal length, at least `size` long
 * @param {number} size frame length, a power of 2
 * @param {number} hop
 * @param {(magnitudes: Float64Array, power: number) => void} visit `power` is the frame's mean
 *   square before windowing
 */
export function forEachMagnitudeFrame(channels, size, hop, visit) {
  const length = channels[0]?.length ?? 0;
  if (length < size) {
    throw new Error(`spectral features need at least ${size} samples, got ${length}`);
  }
  const mix = new Float64Array(length);
  for (const channel of channels) {
    for (let n = 0; n < length; n++) {
      mix[n] =
        /** @type {number} */ (mix[n]) + /** @type {number} */ (channel[n]) / channels.length;
    }
  }
  const hann = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size),
  );
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const magnitudes = new Float64Array(size / 2 + 1);
  for (let start = 0; start + size <= length; start += hop) {
    let power = 0;
    for (let i = 0; i < size; i++) {
      const x = /** @type {number} */ (mix[start + i]);
      power += x * x;
      re[i] = x * /** @type {number} */ (hann[i]);
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < magnitudes.length; k++) {
      magnitudes[k] = Math.hypot(/** @type {number} */ (re[k]), /** @type {number} */ (im[k]));
    }
    visit(magnitudes, power / size);
  }
}

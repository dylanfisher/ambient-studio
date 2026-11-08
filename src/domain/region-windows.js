// The windows a reference region is measured on (decision 0051): excerpt-long, hopped by half
// a window, so a region is read the way a rated excerpt is.
import { EXCERPT_SECONDS } from "./excerpt-seconds.js";

/**
 * A window as frames into the region.
 * @typedef {{ start: number, length: number }} RegionWindow
 */

/**
 * The windows of a region `frames` long. A region no longer than a window is one window, read
 * whole. A longer one gets a window every half window while one fits, and, when those leave a
 * tail, one more ending at the region's end, so no part of it goes unread.
 * @param {number} frames
 * @param {number} sampleRate
 * @returns {RegionWindow[]}
 */
export function regionWindows(frames, sampleRate) {
  if (!(Number.isSafeInteger(frames) && frames > 0)) {
    throw new Error(`a region's windows need a whole number of frames above 0, got ${frames}`);
  }
  const length = Math.round(EXCERPT_SECONDS * sampleRate);
  if (frames <= length) return [{ start: 0, length: frames }];
  const hop = Math.round(length / 2);
  /** @type {RegionWindow[]} */
  const windows = [];
  for (let start = 0; start + length <= frames; start += hop) windows.push({ start, length });
  const last = /** @type {RegionWindow} */ (windows.at(-1));
  if (last.start + length < frames) windows.push({ start: frames - length, length });
  return windows;
}

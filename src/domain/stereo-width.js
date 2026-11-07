import { SILENT_FRAME_POWER } from "./magnitude-frames.js";

/**
 * Side power over mid plus side power, over the whole excerpt (decision 0033), where mid is
 * (L + R) / 2 and side is (L − R) / 2. Identical channels read 0, independent channels of equal
 * level about 0.5, and channels of opposite sign 1. One channel is mono and reads 0, so a mono
 * excerpt is a measured 0, not an unmeasurable one.
 * @param {Float32Array[]} channels one or two channels of equal length
 * @returns {number | null} from 0 to 1; null when the excerpt's mean square is under the
 *   silent-frame level
 */
export function stereoWidth(channels) {
  const [left, right = left] = channels;
  if (left === undefined || right === undefined || channels.length > 2) {
    throw new Error(`stereo width needs one or two channels, got ${channels.length}`);
  }
  let mid = 0;
  let side = 0;
  for (let n = 0; n < left.length; n++) {
    const l = /** @type {number} */ (left[n]);
    const r = /** @type {number} */ (right[n]);
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  // mid + side is the channels' mean power, so the gate reads the same level as a frame's.
  if ((mid + side) / left.length < SILENT_FRAME_POWER) return null;
  return side / (mid + side);
}

// 0012: +1.0 maps to 2^23, which is one step past the largest 24-bit value, so it clips to
// 8388607 while -1.0 lands exactly on -8388608.
/** The 24-bit value of a float sample of 1.0. */
export const FULL_SCALE = 2 ** 23;
const MAX = FULL_SCALE - 1;
const MIN = -FULL_SCALE;

/** Bytes per 24-bit sample. */
export const PCM24_BYTES = 3;

/**
 * Float samples to interleaved little-endian 24-bit PCM, the bytes an export's WAV and FLAC
 * hold and its golden hash covers. Rounds to the nearest step (`Math.round`, so a tie goes
 * toward +infinity) with no dither, and clips out-of-range samples.
 * @param {Float32Array[]} channels one or more channels of equal length
 * @returns {Uint8Array}
 */
export function encodePcm24(channels) {
  const first = channels[0];
  if (!first) throw new Error("encodePcm24 needs at least one channel");
  const frames = first.length;
  for (const [c, channel] of channels.entries()) {
    if (channel.length !== frames) {
      throw new Error(`channel ${c} has length ${channel.length}, channel 0 has ${frames}`);
    }
  }
  const stride = channels.length * PCM24_BYTES;
  const out = new Uint8Array(frames * stride);
  for (const [c, channel] of channels.entries()) {
    let at = c * PCM24_BYTES;
    for (let i = 0; i < frames; i++) {
      const x = /** @type {number} */ (channel[i]);
      if (Number.isNaN(x)) throw new Error(`sample is NaN at channel ${c}, frame ${i}`);
      let v = Math.round(x * FULL_SCALE);
      if (v > MAX) v = MAX;
      else if (v < MIN) v = MIN;
      out[at] = v & 0xff;
      out[at + 1] = (v >> 8) & 0xff;
      out[at + 2] = (v >> 16) & 0xff;
      at += stride;
    }
  }
  return out;
}

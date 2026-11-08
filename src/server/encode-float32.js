import { channelFrames } from "./channel-frames.js";

/** Bytes per 32-bit float sample. */
export const FLOAT32_BYTES = 4;

/**
 * Float samples to interleaved little-endian 32-bit floats, the bytes a float WAV holds. Each
 * value is stored as it is, past full scale included, so the file reads back exactly. A NaN or
 * infinite sample throws, since a player can't play it.
 * @param {Float32Array[]} channels one or more channels of equal length
 * @returns {Uint8Array}
 */
export function encodeFloat32(channels) {
  const frames = channelFrames(channels, "encodeFloat32");
  const stride = channels.length * FLOAT32_BYTES;
  const out = new Uint8Array(frames * stride);
  const view = new DataView(out.buffer);
  for (const [c, channel] of channels.entries()) {
    let at = c * FLOAT32_BYTES;
    for (let i = 0; i < frames; i++) {
      const x = /** @type {number} */ (channel[i]);
      if (!Number.isFinite(x)) throw new Error(`sample is ${x} at channel ${c}, frame ${i}`);
      view.setFloat32(at, x, true);
      at += stride;
    }
  }
  return out;
}

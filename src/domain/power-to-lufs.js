/**
 * BS.1770-4 equation 2: loudness from channel-weighted K-weighted power. The -0.691 cancels the
 * K-weighting gain at 997 Hz. Zero power is `-Infinity`.
 * @param {number} power
 * @returns {number} LUFS
 */
export function powerToLufs(power) {
  return -0.691 + 10 * Math.log10(power);
}

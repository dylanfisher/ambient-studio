// BS.1770-4 gives its K-weighting and true-peak coefficients for 48 kHz, and every render is
// 48 kHz, so the meter takes no other rate (0008).
const METER_SAMPLE_RATE = 48000;

/**
 * Throws unless `sampleRate` is 48000, rather than measuring with coefficients meant for
 * another rate.
 * @param {number} sampleRate
 */
export function requireMeterSampleRate(sampleRate) {
  if (sampleRate !== METER_SAMPLE_RATE) {
    throw new Error(`the loudness meter takes ${METER_SAMPLE_RATE} Hz audio, got ${sampleRate}`);
  }
}

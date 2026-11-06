import { requireMeterSampleRate } from "./meter-sample-rate.js";

/**
 * BS.1770-4 true-peak level: the largest absolute value of any channel after 4x oversampling
 * with the standard's interpolation filter.
 * @param {Float32Array[]} channels any number of channels
 * @param {number} sampleRate must be 48000
 * @returns {number} dBTP; `-Infinity` for silence
 */
export function truePeak(channels, sampleRate) {
  requireMeterSampleRate(sampleRate);
  let peak = 0;
  for (const channel of channels) peak = Math.max(peak, channelPeak(channel));
  return 20 * Math.log10(peak);
}

/**
 * The largest absolute output of the four interpolation phases. Outputs run 11 samples past
 * the end of the input, as if it were followed by zeros, so a peak in the final samples is
 * still measured. The 12.04 dB attenuation in the standard is headroom for integer arithmetic
 * and is left out, since this runs in float64.
 * @param {Float32Array} x
 */
function channelPeak(x) {
  // The last 12 input samples in locals, s0 newest. Unrolled because 1h measures a 300 s render
  // in a loop: this runs about 3x faster than a loop over a tap array.
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let s5 = 0;
  let s6 = 0;
  let s7 = 0;
  let s8 = 0;
  let s9 = 0;
  let s10 = 0;
  let s11 = 0;
  let peak = 0;
  const length = x.length;
  for (let n = 0, end = length + 11; n < end; n++) {
    s11 = s10;
    s10 = s9;
    s9 = s8;
    s8 = s7;
    s7 = s6;
    s6 = s5;
    s5 = s4;
    s4 = s3;
    s3 = s2;
    s2 = s1;
    s1 = s0;
    s0 = n < length ? (x[n] ?? 0) : 0;
    // BS.1770-4 Annex 2's order-48, 4-phase FIR: p{k} is phase k's column of the table, and
    // its row m multiplies s{m}.
    const p0 =
      0.001708984375 * s0 +
      0.010986328125 * s1 -
      0.0196533203125 * s2 +
      0.033203125 * s3 -
      0.0594482421875 * s4 +
      0.1373291015625 * s5 +
      0.97216796875 * s6 -
      0.102294921875 * s7 +
      0.047607421875 * s8 -
      0.026611328125 * s9 +
      0.014892578125 * s10 -
      0.00830078125 * s11;
    const p1 =
      -0.0291748046875 * s0 +
      0.029296875 * s1 -
      0.0517578125 * s2 +
      0.089111328125 * s3 -
      0.16650390625 * s4 +
      0.465087890625 * s5 +
      0.77978515625 * s6 -
      0.2003173828125 * s7 +
      0.1015625 * s8 -
      0.0582275390625 * s9 +
      0.0330810546875 * s10 -
      0.0189208984375 * s11;
    const p2 =
      -0.0189208984375 * s0 +
      0.0330810546875 * s1 -
      0.0582275390625 * s2 +
      0.1015625 * s3 -
      0.2003173828125 * s4 +
      0.77978515625 * s5 +
      0.465087890625 * s6 -
      0.16650390625 * s7 +
      0.089111328125 * s8 -
      0.0517578125 * s9 +
      0.029296875 * s10 -
      0.0291748046875 * s11;
    const p3 =
      -0.00830078125 * s0 +
      0.014892578125 * s1 -
      0.026611328125 * s2 +
      0.047607421875 * s3 -
      0.102294921875 * s4 +
      0.97216796875 * s5 +
      0.1373291015625 * s6 -
      0.0594482421875 * s7 +
      0.033203125 * s8 -
      0.0196533203125 * s9 +
      0.010986328125 * s10 +
      0.001708984375 * s11;
    peak = Math.max(peak, Math.abs(p0), Math.abs(p1), Math.abs(p2), Math.abs(p3));
  }
  return peak;
}

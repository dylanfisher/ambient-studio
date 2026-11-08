/** The filter's value at n is a weighted sum of x[n - 11] to x[n]. */
export const INTERPOLATION_SPAN = 11;

const NO_HISTORY = new Float32Array(0);

/**
 * BS.1770-4's 4x interpolation filter. For each n from `start` to `end - 1`, the largest
 * absolute output of the four phases with x[n] as the newest input sample, which covers the
 * waveform between x[n - 6] and x[n - 5]. Samples after `x` read as zero, so `end` may run
 * 11 samples past the end of the input and a peak in the final samples is still measured.
 * Samples before `x` come from `before`, so a stream read in chunks gives the bits one array
 * would, and read as zero past it. The 12.04 dB attenuation in the standard is headroom for
 * integer arithmetic and is left out, since this runs in float64.
 * @param {Float32Array} x
 * @param {number} start
 * @param {number} end
 * @param {Float64Array} out receives the value for n at out[n - start]
 * @param {Float32Array} [before] the samples just before x[0], newest last
 * @returns {number} the largest of them
 */
export function interpolatedPeaks(x, start, end, out, before = NO_HISTORY) {
  const length = x.length;
  /** @param {number} n */
  const at = (n) => (n >= 0 ? (n < length ? (x[n] ?? 0) : 0) : (before[before.length + n] ?? 0));
  // The last 12 input samples in locals, s0 newest. Unrolled because normalize runs this over
  // a whole render on every pass: this runs about 3x faster than a loop over a tap array.
  let s0 = at(start - 1);
  let s1 = at(start - 2);
  let s2 = at(start - 3);
  let s3 = at(start - 4);
  let s4 = at(start - 5);
  let s5 = at(start - 6);
  let s6 = at(start - 7);
  let s7 = at(start - 8);
  let s8 = at(start - 9);
  let s9 = at(start - 10);
  let s10 = at(start - 11);
  let s11 = 0;
  let peak = 0;
  for (let n = start; n < end; n++) {
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
    const value = Math.max(Math.abs(p0), Math.abs(p1), Math.abs(p2), Math.abs(p3));
    out[n - start] = value;
    peak = Math.max(peak, value);
  }
  return peak;
}

/**
 * Moves `history` on past `chunk`, so it holds the last `history.length` samples of the stream
 * so far, newest last: the `before` for the next chunk.
 * @param {Float32Array} history
 * @param {Float32Array} chunk
 */
export function carryHistory(history, chunk) {
  const span = history.length;
  if (chunk.length >= span) {
    history.set(chunk.subarray(chunk.length - span));
  } else {
    history.copyWithin(0, chunk.length);
    history.set(chunk, span - chunk.length);
  }
}

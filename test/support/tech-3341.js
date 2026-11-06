// Synthesizes the EBU Tech 3341 minimum-requirements test signals (Table 1) at 48 kHz, so the
// loudness and true-peak tests need no downloaded files. Each case is built from its row in
// the table: tone frequency, per-channel peak level and segment durations.

export const SAMPLE_RATE = 48000;

/**
 * One segment of a 1 kHz tone: its length in seconds and its per-channel peak level in dBFS.
 * A level of `-Infinity` is silence.
 * @typedef {{ seconds: number, dbfs: number }} Segment
 */

/** @param {number} dbfs */
export function dbToGain(dbfs) {
  return 10 ** (dbfs / 20);
}

/**
 * A 1 kHz sine made of segments at different levels, phase continuous across the joins, so a
 * level change adds no discontinuity beyond the step in amplitude.
 * @param {Segment[]} segments
 * @returns {Float32Array}
 */
export function toneSegments(segments) {
  const lengths = segments.map((s) => Math.round(s.seconds * SAMPLE_RATE));
  const out = new Float32Array(lengths.reduce((a, b) => a + b, 0));
  let start = 0;
  segments.forEach((segment, i) => {
    const gain = dbToGain(segment.dbfs);
    const end = start + (lengths[i] ?? 0);
    for (let n = start; n < end; n++)
      out[n] = gain * Math.sin((2 * Math.PI * 1000 * n) / SAMPLE_RATE);
    start = end;
  });
  return out;
}

/**
 * The same signal on both channels, as Table 1's "applied in phase to both channels".
 * @param {Float32Array} channel
 * @returns {Float32Array[]}
 */
export function stereo(channel) {
  return [channel, channel.slice()];
}

/**
 * A sine at amplitude `amplitude` and starting phase `degrees`, with the 10 ms linear fade-in
 * and fade-out the true-peak cases ask for.
 * @param {{ frequency: number, amplitude: number, degrees: number, seconds: number }} tone
 * @returns {Float32Array}
 */
export function taperedSine({ frequency, amplitude, degrees, seconds }) {
  const length = Math.round(seconds * SAMPLE_RATE);
  const fade = Math.round(0.01 * SAMPLE_RATE);
  const phase = (degrees * Math.PI) / 180;
  const out = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    const taper = Math.min(1, n / fade, (length - 1 - n) / fade);
    out[n] = taper * amplitude * Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE + phase);
  }
  return out;
}

/**
 * Cases 20 to 23: at 4x the sample rate, a sine at fs/6 and amplitude 0.5 with one period of a
 * sine at fs/4 and amplitude 1.0 spliced in at a zero crossing, so the phase is continuous on
 * both sides. It is tapered, low-pass filtered against aliasing, and decimated by 4 starting at
 * `offset` (0 to 3) samples of the 4x rate.
 * @param {number} offset
 * @returns {Float32Array}
 */
export function splicedBurst(offset) {
  const rate = 4 * SAMPLE_RATE;
  // fs/6 at 4x is 24 samples per period; fs/4 is 16. Whole periods keep the splice on zero
  // crossings.
  const lowPeriod = 24;
  const burstPeriod = 16;
  const lead = 400 * lowPeriod;
  const length = lead + burstPeriod + 400 * lowPeriod;
  const fine = new Float64Array(length);
  const fade = Math.round(0.005 * rate);
  for (let n = 0; n < length; n++) {
    let value;
    if (n < lead) value = 0.5 * Math.sin((2 * Math.PI * n) / lowPeriod);
    else if (n < lead + burstPeriod) value = Math.sin((2 * Math.PI * (n - lead)) / burstPeriod);
    else value = 0.5 * Math.sin((2 * Math.PI * (n - lead - burstPeriod)) / lowPeriod);
    fine[n] = Math.min(1, n / fade, (length - 1 - n) / fade) * value;
  }
  // A steep cutoff near the 24 kHz Nyquist keeps the band-limited peak within 0.25 dB of the
  // 1.0 the case expects; a gentler 20 kHz filter takes 0.25 dB off the peak before the meter
  // sees it.
  const filtered = lowPass(fine, 22000 / rate);
  const out = new Float32Array(Math.floor((length - offset) / 4));
  for (let i = 0; i < out.length; i++) out[i] = filtered[4 * i + offset] ?? 0;
  return out;
}

/**
 * Zero-phase windowed-sinc low-pass (Blackman, 1023 taps), with the cutoff as a fraction of the
 * sample rate.
 * @param {Float64Array} input
 * @param {number} cutoff
 * @returns {Float64Array}
 */
function lowPass(input, cutoff) {
  const half = 511;
  const taps = new Float64Array(2 * half + 1);
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const sinc = k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k);
    const w = (k + half) / (2 * half);
    const blackman = 0.42 - 0.5 * Math.cos(2 * Math.PI * w) + 0.08 * Math.cos(4 * Math.PI * w);
    taps[k + half] = sinc * blackman;
    sum += sinc * blackman;
  }
  const out = new Float64Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += (taps[k + half] ?? 0) * (input[n - k] ?? 0);
    out[n] = acc / sum;
  }
  return out;
}

/**
 * The largest value in `series` among the windows that end in (from, to], for the "live meter"
 * cases that read one maximum per segment. Element j of the series is the window that starts
 * at j * 10 ms and lasts `windowSeconds`.
 * @param {Float64Array} series
 * @param {number} windowSeconds
 * @param {number} fromSeconds
 * @param {number} toSeconds
 */
export function maxEndingBetween(series, windowSeconds, fromSeconds, toSeconds) {
  const from = Math.max(0, Math.round((fromSeconds - windowSeconds) * 100) + 1);
  const to = Math.min(series.length - 1, Math.round((toSeconds - windowSeconds) * 100));
  let max = -Infinity;
  for (let j = from; j <= to; j++) max = Math.max(max, series[j] ?? -Infinity);
  return max;
}

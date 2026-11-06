// The sound of one bell note, computed in JS into samples that an AudioBufferSource plays
// (decision 0013). A buffer lets each partial decay at its own rate, which one PeriodicWave
// can't, for the cost of one node instead of an oscillator and a gain per partial; and a
// Karplus-Strong loop computed here doesn't depend on how the library handles a DelayNode in a
// cycle, which the Web Audio spec holds to at least one 128-frame quantum.

/** Seconds of the linear fade that ends every note at exactly 0. */
const END_FADE = 0.02;
/** FM keeps its carrier plus (index + 1) modulator steps under this, in Hz, so it doesn't alias. */
const FM_TOP = 12000;

/**
 * A sine partial of an additive note.
 * @typedef {object} Partial
 * @property {number} hz
 * @property {number} gain amplitude
 * @property {number} t60 seconds to fall 60 dB
 * @property {number} phase radians at the note's first frame
 */

/**
 * Per-sample decay factor for a fall of 60 dB in `t60` seconds.
 * @param {number} t60
 * @param {number} rate
 */
const decayPerSample = (t60, rate) => 10 ** (-3 / (t60 * rate));

/**
 * The sum of exponentially decaying sines. Each partial runs as the two-term recurrence
 * z[n] = 2r cos(ω) z[n−1] − r² z[n−2], so a long note costs a few multiplies per sample and
 * partial rather than a `Math.sin` call.
 * @param {readonly Partial[]} partials
 * @param {number} frames
 * @param {number} rate
 */
export function additiveTone(partials, frames, rate) {
  const out = new Float64Array(frames);
  for (const { hz, gain, t60, phase } of partials) {
    const w = (2 * Math.PI * hz) / rate;
    const r = decayPerSample(t60, rate);
    const a = 2 * r * Math.cos(w);
    const b = r * r;
    // z[−1] = r^−1 sin(φ − ω), so the recurrence gives z[n] = r^n sin(ωn + φ).
    let previous = (gain * Math.sin(phase - w)) / r;
    let current = gain * Math.sin(phase);
    for (let n = 0; n < frames; n++) {
      out[n] = (out[n] ?? 0) + current;
      const next = a * current - b * previous;
      previous = current;
      current = next;
    }
  }
  return out;
}

/**
 * Two-operator FM: a carrier phase-modulated by a sine at `modulator` Hz, its index falling
 * 60 dB in `indexT60` and its amplitude in `t60`. The starting index is lowered as far as it
 * must be to keep the sidebands under 12 kHz.
 * @param {{ carrier: number; modulator: number; index: number; t60: number; indexT60: number }} fm
 * @param {number} frames
 * @param {number} rate
 */
export function fmTone({ carrier, modulator, index, t60, indexT60 }, frames, rate) {
  const top = Math.max(0, (FM_TOP - carrier) / modulator - 1);
  const out = new Float64Array(frames);
  const fall = decayPerSample(t60, rate);
  const indexFall = decayPerSample(indexT60, rate);
  let amplitude = 1;
  let depth = Math.min(index, top);
  for (let n = 0; n < frames; n++) {
    const t = n / rate;
    out[n] =
      amplitude *
      Math.sin(2 * Math.PI * carrier * t + depth * Math.sin(2 * Math.PI * modulator * t));
    amplitude *= fall;
    depth *= indexFall;
  }
  return out;
}

/**
 * Karplus-Strong: `excitation` (one period of noise) fed into a loop of one period at `hz`,
 * averaged over two neighboring samples each time round, with the loop gain set so the
 * fundamental falls 60 dB in about `t60`. The period is fractional, read by linear
 * interpolation, so the pitch isn't rounded to a whole number of samples.
 * @param {{ hz: number; t60: number; excitation: Float64Array }} pluck
 * @param {number} frames
 * @param {number} rate
 */
export function pluckTone({ hz, t60, excitation }, frames, rate) {
  const period = rate / hz;
  // The two-sample average passes the fundamental at cos(π hz / rate) a trip.
  const loss = Math.cos((Math.PI * hz) / rate);
  const gain = Math.min(1, 10 ** (-3 / (hz * t60)) / loss);
  const out = new Float64Array(frames);
  /** @param {number} position */
  const at = (position) => {
    if (position < 0) return 0;
    const i = Math.floor(position);
    const frac = position - i;
    return (1 - frac) * (out[i] ?? 0) + frac * (out[i + 1] ?? 0);
  };
  for (let n = 0; n < frames; n++) {
    const fed = 0.5 * (at(n - period + 0.5) + at(n - period - 0.5));
    out[n] = (excitation[n] ?? 0) + gain * fed;
  }
  return out;
}

/**
 * A tone shaped into a note: scaled to a peak of `gain`, raised linearly from 0 over `attack`
 * seconds, and faded linearly to exactly 0 over its last 20 ms, so neither edge clicks.
 * @param {Float64Array} tone
 * @param {{ attack: number; gain: number; rate: number }} shape
 * @returns {Float32Array}
 */
export function shapeNote(tone, { attack, gain, rate }) {
  let peak = 0;
  for (const x of tone) peak = Math.max(peak, Math.abs(x));
  if (!(peak > 0)) throw new Error("bell: a note computed to silence");
  const rise = attack * rate;
  const fade = END_FADE * rate;
  const last = tone.length - 1;
  const note = new Float32Array(tone.length);
  for (let n = 0; n < tone.length; n++) {
    const envelope = Math.min(1, n / rise, (last - n) / fade);
    note[n] = ((tone[n] ?? 0) / peak) * gain * envelope;
  }
  return note;
}

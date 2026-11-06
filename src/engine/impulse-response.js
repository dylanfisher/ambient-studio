// The reverb's impulse response, generated from the render's seed (decision 0010): noise under
// a decay that reaches −60 dB at the decay time, through a one-pole low-pass whose cutoff falls
// so 4 kHz decays twice as fast as the low end, as in a large dark room.
import { draw, GENOME_SLOT } from "./prng.js";

const CHANNELS = 2;
/** The frequency whose RT60 is half the decay time. */
const DARK_HZ = 4000;

/**
 * Two uncorrelated channels, `decay` seconds long, scaled to a total energy of 1 per channel on
 * average, so the reverb's wet level is about its send level on steady input.
 * @param {number} seed the render's seed; the noise is drawn under voice id "" (decision 0003)
 * @param {number} decay RT60 of the low end, in seconds
 * @param {number} sampleRate
 * @returns {Float32Array<ArrayBuffer>[]} one array per channel
 */
export function impulseResponse(seed, decay, sampleRate) {
  const frames = Math.round(decay * sampleRate);
  const channels = Array.from({ length: CHANNELS }, () => new Float32Array(frames));
  const state = new Float64Array(CHANNELS);
  let energy = 0;
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    // 10^(−3t/T) is −60 dB at T.
    const envelope = 10 ** ((-3 * time) / decay);
    // A one-pole low-pass at fc passes DARK_HZ at 1 / sqrt(1 + (DARK_HZ / fc)²). Choosing fc so
    // that equals the envelope again makes DARK_HZ fall 60 dB in T / 2, while frequencies well
    // under fc keep the envelope's decay.
    const g = 10 ** ((6 * time) / decay) - 1;
    const a = g > 0 ? Math.exp((-2 * Math.PI * DARK_HZ) / Math.sqrt(g) / sampleRate) : 0;
    for (let c = 0; c < CHANNELS; c++) {
      const noise = 2 * draw(seed, "", i * CHANNELS + c, GENOME_SLOT.reverb) - 1;
      const y = (1 - a) * noise + a * /** @type {number} */ (state[c]);
      state[c] = y;
      const value = envelope * y;
      /** @type {Float32Array} */ (channels[c])[i] = value;
      energy += value * value;
    }
  }
  const scale = 1 / Math.sqrt(energy / CHANNELS);
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) channel[i] = /** @type {number} */ (channel[i]) * scale;
  }
  return channels;
}

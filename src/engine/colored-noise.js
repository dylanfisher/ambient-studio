// White, pink and brown noise as a function of the seed and the timeline frame alone (decision
// 0014), so any stretch of it is computed the same in an excerpt as in a full render. White
// noise is one draw per frame and channel; pink and brown filter it, starting each stretch from
// silence half a second early, by when the filters' state from before has decayed under 1e-11.
import { drawer } from "./prng.js";

export const NOISE_COLORS = Object.freeze(/** @type {const} */ (["white", "pink", "brown"]));
/** The color between white and brown, the noise bed's default. */
export const PINK = NOISE_COLORS[1];
/** @typedef {(typeof NOISE_COLORS)[number]} NoiseColor */

/** Frames each stretch starts early: the slowest pole, 0.99886, falls to 1.3e-12 over them. */
const WARM_UP = 24000;

/**
 * Pink by Paul Kellet's filter: six one-pole sections in parallel plus a direct path, within
 * 0.05 dB of −3 dB an octave from 10 Hz up at 44.1 kHz, and close to it at 48 kHz.
 */
const PINK_POLES = [0.99886, 0.99332, 0.969, 0.8665, 0.55, -0.7616];
const PINK_INPUTS = [0.0555179, 0.0750759, 0.153852, 0.3104856, 0.5329522, -0.016898];
const PINK_DIRECT = 0.5362;
/** A one-sample-delayed path of Kellet's filter. */
const PINK_DELAYED = 0.115926;

/** Brown by a leaky integrator: −6 dB an octave above its corner at about 15 Hz. */
const BROWN_POLE = 0.998;

/** @param {Float64Array} state @param {number} white */
function pinkStep(state, white) {
  let sum = PINK_DIRECT * white + /** @type {number} */ (state[PINK_POLES.length]);
  for (let i = 0; i < PINK_POLES.length; i++) {
    const y =
      /** @type {number} */ (PINK_POLES[i]) * /** @type {number} */ (state[i]) +
      /** @type {number} */ (PINK_INPUTS[i]) * white;
    state[i] = y;
    sum += y;
  }
  state[PINK_POLES.length] = PINK_DELAYED * white;
  return sum;
}

/**
 * The pink filter's gain for unit-variance input to give unit-variance output: one over the
 * root of its impulse response's energy, which has fallen under 1e-20 by 50,000 samples.
 */
const PINK_GAIN = (() => {
  const state = new Float64Array(PINK_POLES.length + 1);
  let energy = 0;
  for (let i = 0; i < 50000; i++) energy += pinkStep(state, i === 0 ? 1 : 0) ** 2;
  return 1 / Math.sqrt(energy);
})();
/** The same for the leaky integrator, whose energy is 1 / (1 − p²). */
const BROWN_GAIN = Math.sqrt(1 - BROWN_POLE * BROWN_POLE);

/**
 * One channel of noise for timeline frames `[first, first + frames)`, at the RMS of uniform
 * white noise in [−1, 1), 1/√3, whatever its color. Frames before timeline 0 are silence.
 * @param {{ seed: number; voiceId: string; slot: number; color: NoiseColor; channel: number;
 *   channels: number; first: number; frames: number }} where draws are keyed by
 *   `frame × channels + channel` in `slot` (decision 0003)
 * @returns {Float32Array<ArrayBuffer>}
 */
export function coloredNoise({ seed, voiceId, slot, color, channel, channels, first, frames }) {
  const out = new Float32Array(frames);
  const begin = color === "white" ? first : first - WARM_UP;
  const pink = new Float64Array(PINK_POLES.length + 1);
  let brown = 0;
  const next = drawer(seed, voiceId);
  for (let frame = Math.max(0, begin); frame < first + frames; frame++) {
    const white = 2 * next(frame * channels + channel, slot) - 1;
    let value = white;
    if (color === PINK) value = PINK_GAIN * pinkStep(pink, white);
    else if (color === "brown") {
      brown = BROWN_POLE * brown + white;
      value = BROWN_GAIN * brown;
    }
    if (frame >= first) out[frame - first] = value;
  }
  return out;
}

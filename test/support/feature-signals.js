// Test signals for the feature and render-check tests, at 48 kHz. Noise comes from the engine's
// counter-based PRNG, so every run builds the same samples.
import { drawer } from "../../src/engine/prng.js";
import { SAMPLE_RATE } from "./tech-3341.js";

/**
 * Uniform white noise in [-amplitude, amplitude).
 * @param {number} seconds
 * @param {{ amplitude?: number, seed?: number }} [options]
 * @returns {Float32Array}
 */
export function whiteNoise(seconds, { amplitude = 0.5, seed = 1 } = {}) {
  const next = drawer(seed, "white-noise");
  return Float32Array.from(
    { length: Math.round(seconds * SAMPLE_RATE) },
    (_, n) => amplitude * (2 * next(n, 0) - 1),
  );
}

/**
 * Clicks at `rate` a second, each a 5 ms burst of noise under an exponential decay, on silence.
 * The first click lands half a period in, so none sits on the signal's first frame.
 * @param {number} seconds
 * @param {number} rate clicks a second
 * @returns {Float32Array}
 */
export function clicks(seconds, rate) {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const burst = whiteNoise(0.005, { amplitude: 0.8, seed: 2 });
  const tau = burst.length / 5;
  for (let t = 0.5 / rate; t < seconds; t += 1 / rate) {
    const start = Math.round(t * SAMPLE_RATE);
    for (let i = 0; i < burst.length && start + i < out.length; i++) {
      out[start + i] = /** @type {number} */ (burst[i]) * Math.exp(-i / tau);
    }
  }
  return out;
}

/**
 * Three detuned sines under a 0.1 Hz swell: a sustained drone with no attacks.
 * @param {number} seconds
 * @returns {Float32Array}
 */
export function drone(seconds) {
  return Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, n) => {
    const t = n / SAMPLE_RATE;
    const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.1 * t);
    const tone = [110, 110.7, 165.2].reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t), 0);
    return (0.2 * swell * tone) / 3;
  });
}

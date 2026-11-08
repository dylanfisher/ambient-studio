// What the whole-array meters, limiter and normalize give for one signal, in the form
// test/fixtures/whole-array/outputs.json stores it. The fixture was made by running this over the
// meter code as it was before the streaming forms (decision 0060), so the test that compares the
// current code with it catches any drift from those bits.
import { createHash } from "node:crypto";

/**
 * @typedef {object} WholeArrayFunctions
 * @property {(channels: Float32Array[], sampleRate: number) => number} integratedLoudness
 * @property {(channels: Float32Array[], sampleRate: number) => number} truePeak
 * @property {(input: Float32Array[], output: Float32Array[], gain: number, threshold: number,
 *   sampleRate: number) => void} limitTruePeak
 * @property {(channels: Float32Array[], sampleRate: number, options: { target: number }) =>
 *   { channels: Float32Array[], loudness: number, truePeak: number, gainDb: number }} normalize
 */

const SAMPLE_RATE = 48000;
/** The limiter threshold the fixture uses: -1.4 dBTP, normalize's default. */
const THRESHOLD = 10 ** (-1.4 / 20);
const NORMALIZE_TARGET = -14;

/** @param {Float32Array[]} channels */
function sha256(channels) {
  const hash = createHash("sha256");
  for (const c of channels) hash.update(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
  return hash.digest("hex");
}

/** JSON has no -Infinity, so it is stored as a string. @param {number} x */
const exact = (x) => (Number.isFinite(x) ? x : String(x));

/**
 * A gain that puts the sample peak 6 dB over the threshold, so the limiter works.
 * @param {Float32Array[]} channels
 */
function overGain(channels) {
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  return peak > 0 ? (2 * THRESHOLD) / peak : 1;
}

/**
 * @param {WholeArrayFunctions} f
 * @param {Float32Array[]} channels
 */
export function wholeArrayOutputs(f, channels) {
  const limited = channels.map((channel) => new Float32Array(channel.length));
  f.limitTruePeak(channels, limited, overGain(channels), THRESHOLD, SAMPLE_RATE);
  /** @type {unknown} */
  let normalized;
  try {
    const n = f.normalize(channels, SAMPLE_RATE, { target: NORMALIZE_TARGET });
    normalized = {
      loudness: n.loudness,
      truePeak: n.truePeak,
      gainDb: n.gainDb,
      sha256: sha256(n.channels),
    };
  } catch (error) {
    normalized = { error: /** @type {Error} */ (error).message };
  }
  return {
    integratedLoudness: exact(f.integratedLoudness(channels, SAMPLE_RATE)),
    truePeak: exact(f.truePeak(channels, SAMPLE_RATE)),
    limiterSha256: sha256(limited),
    normalized,
  };
}

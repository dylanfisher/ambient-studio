import { forEachMagnitudeFrame, SILENT_FRAME_POWER } from "./magnitude-frames.js";

// Parameters from decision 0023, tuned on the test signals and the golden genomes. 2048 samples
// is 43 ms at 48 kHz, long enough to resolve partials a fifth apart at 110 Hz, whose beating in
// a shorter frame reads as onsets; the hop is 10.7 ms.
const FRAME = 2048;
const HOP = 512;
/**
 * Magnitudes are compressed as log(1 + COMPRESSION * |X|) before the flux, so a quiet attack
 * counts beside a loud sustained partial. The flux is read on normalized audio, so the
 * constant sees one level range.
 */
const COMPRESSION = 30;
/** Frames each side of a frame whose median flux sets its threshold: about 0.5 s. */
const MEDIAN_FRAMES = 47;
/** Frames each side a peak must be the largest of: about 43 ms. */
const PEAK_FRAMES = 4;
/** The threshold is FLOOR plus MULTIPLIER times the local median flux. */
const FLOOR = 0.1;
const MULTIPLIER = 1.5;

/**
 * Onsets a second: peaks of spectral flux above an adaptive threshold. A frame's flux is the
 * compressed magnitude its bins gained since the previous frame, as a share of its total. The
 * first frame has no previous one and a silent frame says nothing, so both read 0.
 * @param {Float32Array[]} channels one or more channels of equal length, mixed to mono
 * @param {number} sampleRate
 * @returns {number}
 */
export function onsetRate(channels, sampleRate) {
  /** @type {number[]} */
  const flux = [];
  /** @type {Float64Array | undefined} */
  let previous;
  forEachMagnitudeFrame(channels, FRAME, HOP, (magnitudes, power) => {
    const compressed = magnitudes.map((magnitude) => Math.log1p(COMPRESSION * magnitude));
    flux.push(previous && power >= SILENT_FRAME_POWER ? gainedShare(previous, compressed) : 0);
    previous = compressed;
  });
  let onsets = 0;
  for (const [t, value] of flux.entries()) {
    if (value > threshold(flux, t) && isPeak(flux, t)) onsets++;
  }
  const seconds = /** @type {Float32Array} */ (channels[0]).length / sampleRate;
  return onsets / seconds;
}

/**
 * The magnitude the bins gained from `previous` to `current`, as a share of `current`'s total.
 * @param {Float64Array} previous
 * @param {Float64Array} current
 */
function gainedShare(previous, current) {
  let gained = 0;
  let total = 0;
  for (const [k, magnitude] of current.entries()) {
    gained += Math.max(0, magnitude - /** @type {number} */ (previous[k]));
    total += magnitude;
  }
  return gained / total;
}

/** @param {number[]} flux @param {number} t */
function threshold(flux, t) {
  const around = flux
    .slice(Math.max(0, t - MEDIAN_FRAMES), t + MEDIAN_FRAMES + 1)
    .sort((a, b) => a - b);
  return FLOOR + MULTIPLIER * /** @type {number} */ (around[Math.floor(around.length / 2)]);
}

/**
 * The largest flux within PEAK_FRAMES each side; on a tie, the earliest frame is the peak.
 * @param {number[]} flux
 * @param {number} t
 */
function isPeak(flux, t) {
  const value = /** @type {number} */ (flux[t]);
  for (let u = Math.max(0, t - PEAK_FRAMES); u <= t + PEAK_FRAMES && u < flux.length; u++) {
    const other = /** @type {number} */ (flux[u]);
    if (u < t ? other >= value : other > value) return false;
  }
  return true;
}

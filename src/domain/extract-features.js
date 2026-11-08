// An excerpt's measured features (decisions 0023 and 0033). Loudness and peaks are read on the
// raw render, where they say how the genome itself plays; the spectrum, onsets and width on the
// normalized audio the owner hears. Every value is a finite number or null, so the object
// stores as JSON as is.
/** @import { RenderResult } from "../engine/render-plan.js" */
/** @import { Normalized } from "./normalize.js" */
import { integratedLoudness } from "./integrated-loudness.js";
import { loudnessRange } from "./loudness-range.js";
import { lowEndShare } from "./low-end-share.js";
import { onsetRate } from "./onset-rate.js";
import { shortTermLoudness } from "./short-term-loudness.js";
import { spectralCentroid } from "./spectral-centroid.js";
import { spectralFlatness } from "./spectral-flatness.js";
import { stereoWidth } from "./stereo-width.js";
import { truePeak } from "./true-peak.js";

/**
 * Read on the raw render; null where nothing is measurable, as on silence.
 * @typedef {object} RawFeatures
 * @property {number | null} loudness integrated, LUFS
 * @property {number | null} shortTermMax the loudest 3 s window, LUFS
 * @property {number | null} loudnessRange EBU Tech 3342, LU
 * @property {number | null} truePeak dBTP
 */

/**
 * Read on the normalized excerpt.
 * @typedef {object} HeardFeatures
 * @property {number} gainDb the gain normalize applied before its limiter
 * @property {number | null} centroidMean Hz
 * @property {number | null} centroidSpread Hz, the standard deviation over frames
 * @property {number} onsetRate onsets a second
 * @property {number | null} lowEndShare the share of spectral power under 150 Hz
 * @property {number | null} stereoWidth side power over mid plus side power, 0 for mono
 * @property {number | null} flatness mean spectral flatness, 0 for a pure tone, about 0.85 for
 *   white noise
 */

/**
 * @typedef {object} Features
 * @property {RawFeatures} raw
 * @property {HeardFeatures | null} heard null when normalize couldn't run on the render
 */

/** @param {number} value */
const measured = (value) => (Number.isFinite(value) ? value : null);

/**
 * @param {Pick<RenderResult, "channels" | "sampleRate">} raw the render before normalize, or a
 *   reference window as decoded
 * @param {Normalized | null} heard what `normalize` returned for it, or null when it threw
 * @returns {Features}
 */
export function extractFeatures(raw, heard) {
  const { channels, sampleRate } = raw;
  const shortTerm = shortTermLoudness(channels, sampleRate);
  return {
    raw: {
      loudness: measured(integratedLoudness(channels, sampleRate)),
      shortTermMax: measured(shortTerm.reduce((a, lufs) => Math.max(a, lufs), -Infinity)),
      loudnessRange: loudnessRange(shortTerm),
      truePeak: measured(truePeak(channels, sampleRate)),
    },
    heard: heard && heardFeatures(heard, sampleRate),
  };
}

/**
 * @param {Normalized} heard
 * @param {number} sampleRate
 * @returns {HeardFeatures}
 */
function heardFeatures({ channels, gainDb }, sampleRate) {
  const centroid = spectralCentroid(channels, sampleRate);
  return {
    gainDb,
    centroidMean: centroid.mean,
    centroidSpread: centroid.spread,
    onsetRate: onsetRate(channels, sampleRate),
    lowEndShare: lowEndShare(channels, sampleRate),
    stereoWidth: stereoWidth(channels),
    flatness: spectralFlatness(channels, sampleRate),
  };
}

/** @import { NormalizeOptions } from "./normalize-passes.js" */
import { integratedLoudness } from "./integrated-loudness.js";
import { limitTruePeak } from "./limit-true-peak.js";
import { normalizePasses } from "./normalize-passes.js";
import { truePeak } from "./true-peak.js";

/**
 * @typedef {object} Normalized
 * @property {Float32Array[]} channels new buffers; the input is left unchanged
 * @property {number} loudness integrated loudness of `channels`, LUFS
 * @property {number} truePeak true peak of `channels`, dBTP
 * @property {number} gainDb the gain applied before the limiter
 */

/**
 * Brings `channels` to `target` integrated loudness, with a true-peak limiter at `ceiling`.
 * Limiting lowers loudness, so the gain is raised and the limiter rerun until the result is
 * within 0.1 LU of the target, or within 0.5 LU when the passes run out (`normalizePasses`).
 * @param {Float32Array[]} channels one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @param {NormalizeOptions} options LUFS and dBTP
 * @returns {Normalized}
 */
export function normalize(channels, sampleRate, options) {
  const passes = normalizePasses(options)(integratedLoudness(channels, sampleRate));
  let step = passes.next();
  const output = channels.map((channel) => new Float32Array(channel.length));
  while (!step.done) {
    const { gainDb, threshold } = step.value;
    // The input is never changed, so each pass limits the original signal at the new gain.
    limitTruePeak(channels, output, 10 ** (gainDb / 20), threshold, sampleRate);
    step = passes.next({
      loudness: integratedLoudness(output, sampleRate),
      truePeak: () => truePeak(output, sampleRate),
    });
  }
  const { loudness, truePeak: peak, gainDb } = step.value;
  return { channels: output, loudness, truePeak: peak, gainDb };
}

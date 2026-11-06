import { integratedLoudness } from "./integrated-loudness.js";
import { limitTruePeak } from "./limit-true-peak.js";
import { truePeak } from "./true-peak.js";

// Parameters from 0011.
const DEFAULT_CEILING_DBTP = -1;
const MAX_GAIN_DB = 40;
// Passes stop within AIM_LU of the target; a result within TOLERANCE_LU is accepted only when
// the passes or the gain cap run out.
const AIM_LU = 0.1;
const TOLERANCE_LU = 0.5;
const MAX_PASSES = 8;
// truePeak reads up to 0.31 dB under the band-limited peak (0008), so a reading at the ceiling
// can be over it. The limiter holds the reading 0.4 dB under the ceiling, and a result that
// reads within 0.31 dB of the ceiling throws.
const METER_UNDER_READ_DB = 0.31;
const LIMITER_MARGIN_DB = 0.4;

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
 * within 0.1 LU of the target, or within 0.5 LU when the passes run out.
 * @param {Float32Array[]} channels one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @param {{ target: number, ceiling?: number }} options LUFS and dBTP
 * @returns {Normalized}
 */
export function normalize(channels, sampleRate, { target, ceiling = DEFAULT_CEILING_DBTP }) {
  if (!Number.isFinite(target)) {
    throw new Error(`normalize needs a loudness target in LUFS, got ${target}`);
  }
  const before = integratedLoudness(channels, sampleRate);
  if (before === -Infinity) {
    throw new Error(
      "normalize: the signal's loudness is -Infinity (no block above the -70 LUFS gate)",
    );
  }
  let gainDb = target - before;
  if (gainDb > MAX_GAIN_DB) {
    throw new Error(
      `normalize: bringing ${before.toFixed(1)} LUFS to ${target} LUFS needs ` +
        `${gainDb.toFixed(1)} dB of gain, more than the ${MAX_GAIN_DB} dB cap`,
    );
  }
  const threshold = 10 ** ((ceiling - LIMITER_MARGIN_DB) / 20);
  const output = channels.map((channel) => new Float32Array(channel.length));
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    limitTruePeak(channels, output, 10 ** (gainDb / 20), threshold, sampleRate);
    const loudness = integratedLoudness(output, sampleRate);
    const error = target - loudness;
    const next = gainDb + error;
    // Past the cap, the limiter is taking back whatever gain is added.
    const last = pass === MAX_PASSES || next > MAX_GAIN_DB;
    if (Math.abs(error) <= AIM_LU || (last && Math.abs(error) <= TOLERANCE_LU)) {
      return {
        channels: output,
        loudness,
        truePeak: checkedPeak(output, sampleRate, ceiling),
        gainDb,
      };
    }
    if (last) {
      throw new Error(
        `normalize can't reach ${target} LUFS: after ${pass} passes the limited signal reads ` +
          `${loudness.toFixed(2)} LUFS, ${(-error).toFixed(1)} LU from the target`,
      );
    }
    gainDb = next;
  }
  throw new Error("unreachable: the last pass returns or throws");
}

/**
 * The output's true peak, throwing if it reads within the meter's under-read of the ceiling.
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {number} ceiling dBTP
 */
function checkedPeak(channels, sampleRate, ceiling) {
  const peak = truePeak(channels, sampleRate);
  if (peak > ceiling - METER_UNDER_READ_DB) {
    throw new Error(
      `normalize: the limited signal reads ${peak.toFixed(2)} dBTP, over the ` +
        `${ceiling} dBTP ceiling less the meter's ${METER_UNDER_READ_DB} dB under-read`,
    );
  }
  return peak;
}

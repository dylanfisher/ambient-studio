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
 * @typedef {object} NormalizeOptions
 * @property {number} target LUFS
 * @property {number} [ceiling] dBTP, -1 when omitted
 */

/**
 * One limiter pass to run: the input times `10 ** (gainDb / 20)`, limited at `threshold`.
 * @typedef {object} NormalizePass
 * @property {number} gainDb
 * @property {number} threshold linear
 */

/**
 * What a pass measured on its output.
 * @typedef {object} PassMeasure
 * @property {number} loudness integrated, LUFS
 * @property {() => number} truePeak dBTP, read only for the pass that is accepted
 */

/**
 * @typedef {object} NormalizeResult
 * @property {number} loudness integrated loudness of the output, LUFS
 * @property {number} truePeak true peak of the output, dBTP
 * @property {number} gainDb the gain applied before the limiter
 * @property {number} threshold the limiter's threshold, linear
 */

/**
 * The pass loop of 0011, apart from the audio, so `normalize` over arrays and `normalizeStream`
 * over a source run the same decisions. Limiting lowers loudness, so the gain is raised and
 * the limiter rerun until the result is within 0.1 LU of the target, or within 0.5 LU when the
 * passes run out. Throws on a missing target at once, before any audio is read.
 * @param {NormalizeOptions} options
 * @returns {(before: number) => Generator<NormalizePass, NormalizeResult, PassMeasure>} given
 *   the input's integrated loudness, yields each pass to run and takes back what it measured
 */
export function normalizePasses({ target, ceiling = DEFAULT_CEILING_DBTP }) {
  if (!Number.isFinite(target)) {
    throw new Error(`normalize needs a loudness target in LUFS, got ${target}`);
  }
  const threshold = 10 ** ((ceiling - LIMITER_MARGIN_DB) / 20);
  return function* passes(before) {
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
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      const { loudness, truePeak } = yield { gainDb, threshold };
      const error = target - loudness;
      const next = gainDb + error;
      // Past the cap, the limiter is taking back whatever gain is added.
      const last = pass === MAX_PASSES || next > MAX_GAIN_DB;
      if (Math.abs(error) <= AIM_LU || (last && Math.abs(error) <= TOLERANCE_LU)) {
        return { loudness, truePeak: checkedPeak(truePeak(), ceiling), gainDb, threshold };
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
  };
}

/**
 * The output's true peak, throwing if it reads within the meter's under-read of the ceiling.
 * @param {number} peak dBTP
 * @param {number} ceiling dBTP
 */
function checkedPeak(peak, ceiling) {
  if (peak > ceiling - METER_UNDER_READ_DB) {
    throw new Error(
      `normalize: the limited signal reads ${peak.toFixed(2)} dBTP, over the ` +
        `${ceiling} dBTP ceiling less the meter's ${METER_UNDER_READ_DB} dB under-read`,
    );
  }
  return peak;
}

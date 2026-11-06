// Turns scale degrees into frequencies (decision 0004).
/** @import { AbsoluteTuning, RelativeTuning, Tuning } from "./tuning.js" */
import { isAbsolute } from "./tuning.js";

/**
 * @typedef {object} RelativePitch
 * @property {RelativeTuning} tuning
 * @property {readonly number[]} scale degree indices of the tuning, from 0
 * @property {number} key the tuning degree that scale degree 0 lands on
 */

/**
 * @typedef {object} AbsolutePitch
 * @property {AbsoluteTuning} tuning
 * @property {readonly number[]} scale indices into the tuning's frequencies
 */

/** @typedef {RelativePitch | AbsolutePitch} Pitch */

/**
 * A tuning, one of its scales, and for a relative tuning the key. An absolute tuning has no
 * root, so a key for it throws.
 * @param {Tuning} tuning
 * @param {string} scaleName
 * @param {number} [key] a degree of a relative tuning
 * @returns {Pitch}
 */
export function resolvePitch(tuning, scaleName, key) {
  const scale = Object.hasOwn(tuning.scales, scaleName) ? tuning.scales[scaleName] : undefined;
  if (!scale) {
    const names = Object.keys(tuning.scales).join(", ");
    throw new Error(`${tuning.id} has no scale "${scaleName}"; it has ${names}`);
  }
  if (isAbsolute(tuning)) {
    if (key !== undefined) throw new Error(`${tuning.id} is absolute, so it has no key`);
    return { tuning, scale };
  }
  if (key === undefined) throw new Error(`${tuning.id} is relative, so it needs a key`);
  if (!Number.isInteger(key) || key < 0 || key >= tuning.degrees.length) {
    throw new Error(`${tuning.id}: key ${key} is not one of its ${tuning.degrees.length} degrees`);
  }
  return { tuning, scale, key };
}

/**
 * The frequency in Hz of a scale degree. In a relative tuning a degree past either end of the
 * scale moves into the next or previous octave (period). An absolute tuning takes no octave,
 * and a degree outside its scale throws.
 * @param {Pitch} pitch
 * @param {number} degree index into the scale
 * @param {number} [octave] which period of a relative tuning
 */
export function frequency(pitch, degree, octave) {
  const { tuning, scale } = pitch;
  if (!Number.isInteger(degree)) throw new Error(`${tuning.id}: degree ${degree} is not whole`);
  if (!("key" in pitch)) {
    if (octave !== undefined) throw new Error(`${tuning.id} is absolute, so it has no octave`);
    const index = scale[degree];
    if (index === undefined || !isAbsolute(tuning)) {
      throw new Error(
        `${tuning.id}: degree ${degree} is outside the scale's 0–${scale.length - 1}`,
      );
    }
    return /** @type {number} */ (tuning.frequencies[index]);
  }
  if (octave === undefined || !Number.isInteger(octave)) {
    throw new Error(`${tuning.id} is relative, so it needs a whole octave, got ${octave}`);
  }
  const { degrees, period, reference } = pitch.tuning;
  const wraps = Math.floor(degree / scale.length);
  const step = pitch.key + /** @type {number} */ (scale[degree - wraps * scale.length]);
  const index = step % degrees.length;
  const periods = octave + wraps + Math.floor(step / degrees.length) - reference.octave;
  const ratio =
    /** @type {number} */ (degrees[index]) / /** @type {number} */ (degrees[reference.degree]);
  return reference.hz * ratio * period ** periods;
}

/**
 * Every frequency the pitch's scale allows from `loHz` to `hiHz` inclusive, rising, so a voice
 * can draw notes and partials from one set.
 * @param {Pitch} pitch
 * @param {number} loHz
 * @param {number} hiHz
 */
export function tuningFrequencies(pitch, loHz, hiHz) {
  if (!(loHz > 0 && loHz <= hiHz && Number.isFinite(hiHz))) {
    throw new Error(`the band must have 0 < loHz <= hiHz, got ${loHz}–${hiHz}`);
  }
  /** @param {number} hz */
  const inBand = (hz) => hz >= loHz && hz <= hiHz;
  if (!("key" in pitch))
    return pitch.scale.map((_, degree) => frequency(pitch, degree)).filter(inBand);
  const { period } = pitch.tuning;
  const base = frequency(pitch, 0, 0);
  const lowest = Math.floor(Math.log(loHz / base) / Math.log(period)) - 1;
  const highest = Math.ceil(Math.log(hiHz / base) / Math.log(period));
  /** @type {number[]} */
  const found = [];
  for (let octave = lowest; octave <= highest; octave++) {
    pitch.scale.forEach((_, degree) => {
      const hz = frequency(pitch, degree, octave);
      if (inBand(hz)) found.push(hz);
    });
  }
  return found;
}

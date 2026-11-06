// Counter-based randomness (decision 0003). A draw is a hash of its whole key, not the next value
// of a running stream, so adding a voice or an event never moves another draw.

const MAX_KEY = 0xffffffff;
const INITIAL_STATE = 0x9e3779b9;

/** The slot `fires` draws from. A voice numbers its own per-event slots from 1. */
export const TRIGGER_SLOT = 0;

/**
 * Slots of the draws not tied to a voice, which use voice id "" (decision 0003). One list, so
 * two uses never share a key.
 */
export const GENOME_SLOT = Object.freeze({ excerpt: 1, randomGenome: 2, reverb: 3 });

/**
 * The lowbias32 integer finalizer (Chris Wellons): a bijection on 32-bit integers in which each
 * input bit flips each output bit with probability close to 1/2. `Math.imul` and the shifts are
 * exact integer operations, so every JS engine gives the same result.
 * @param {number} x
 */
function mix(x) {
  let h = x ^ (x >>> 16);
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** @param {number} state @param {number} word */
const absorb = (state, word) => mix((state ^ word) >>> 0);

/** @param {string} name @param {number} value */
function checkKey(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_KEY) {
    throw new RangeError(`prng: ${name} must be an integer in [0, ${MAX_KEY}], got ${value}`);
  }
}

/**
 * A uniform value in [0, 1) at a resolution of 2^-32, fixed by its key.
 * @param {number} seed the render's seed
 * @param {string} voiceId
 * @param {number} eventIndex a candidate slot on the voice's own grid, not a count of events
 *   that fired, so a change in density doesn't renumber later events
 * @param {number} slot which of the event's draws this is
 */
export function draw(seed, voiceId, eventIndex, slot) {
  checkKey("seed", seed);
  checkKey("eventIndex", eventIndex);
  checkKey("slot", slot);
  // The length goes in first, so "a" and "a\0" absorb different words.
  let state = absorb(absorb(INITIAL_STATE, seed), voiceId.length);
  for (let i = 0; i < voiceId.length; i++) state = absorb(state, voiceId.charCodeAt(i));
  return absorb(absorb(state, eventIndex), slot) / 2 ** 32;
}

/**
 * Thinning: whether the candidate at `eventIndex` fires, given the density at its time. Each
 * candidate has one fixed draw, so raising the density keeps every event that fired and adds
 * new ones.
 * @param {number} seed
 * @param {string} voiceId
 * @param {number} eventIndex
 * @param {number} density probability in [0, 1] that the candidate fires
 */
export function fires(seed, voiceId, eventIndex, density) {
  if (!(density >= 0 && density <= 1)) {
    throw new RangeError(`prng: density must be in [0, 1], got ${density}`);
  }
  return draw(seed, voiceId, eventIndex, TRIGGER_SLOT) < density;
}

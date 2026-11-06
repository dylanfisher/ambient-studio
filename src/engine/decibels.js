/**
 * Amplitude gain for a level in dB.
 * @param {number} db
 */
export const dbToGain = (db) => 10 ** (db / 20);

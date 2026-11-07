// What the card's lock control offers to lock on a candidate (decision 0039): its global
// values, its macros, and each voice whole or one parameter at a time, as lock paths (0035).
// Only what the genome holds is listed, since a lock takes its value from the candidate. No DOM.
/** @import { Genome } from "../engine/genome-schema.js" */
import { GENOME_KEY, GLOBAL_PARAMS, MACROS, VOICE_KEYS } from "../engine/genome-schema.js";
import { voiceParams } from "../engine/voice-registry.js";

/** @typedef {{ path: string, label: string }} LockChoice */
/** @typedef {{ label: string, choices: LockChoice[] }} LockGroup */

/**
 * @param {Genome} genome the candidate's
 * @returns {LockGroup[]} the whole piece's values, the macros, then one group per voice
 */
export function lockChoices(genome) {
  /** @type {Record<string, unknown>} */
  const values = /** @type {any} */ (genome);
  const piece = Object.entries(GLOBAL_PARAMS)
    .filter(([name]) => values[name] !== undefined)
    .map(([name, { description }]) => ({ path: name, label: `${name}: ${description}` }));
  const macros = Object.keys(MACROS).map((name) => ({
    path: `${GENOME_KEY.macros}.${name}`,
    label: name,
  }));
  const voices = genome.voices.map((voice) => {
    /** @type {Record<string, unknown>} */
    const held = /** @type {any} */ (voice);
    const path = `${GENOME_KEY.voices}.${voice.id}`;
    const params = Object.entries(voiceParams(voice.type))
      .filter(([name]) => !VOICE_KEYS.includes(name) && held[name] !== undefined)
      .map(([name, { description }]) => ({
        path: `${path}.${name}`,
        label: `${voice.id} ${name}: ${description}`,
      }));
    return {
      label: `Voice ${voice.id} (a ${voice.type} voice)`,
      choices: [{ path, label: `the whole ${voice.id} voice, every parameter` }, ...params],
    };
  });
  return [
    { label: "The whole piece", choices: piece },
    { label: "Macros", choices: macros },
    ...voices,
  ];
}

// Every voice type the engine knows. A voice module is added with one import line here and its
// name in `builtIn`; the schema, the macro table and `randomGenome` read voices from this module
// only. Tests register the fixture voice from test/support/ in `beforeAll` and unregister it in
// `afterAll`, so this file never imports test code (decision 0005).
/** @import { DescriptorTable } from "./descriptor.js" */
/** @import { MacroRow } from "./macro-table.js" */
import { VOICE_KEYS, VOICE_PARAMS } from "./genome-schema.js";
import { checkMacroRows } from "./macro-table.js";

/**
 * @typedef {object} VoiceType
 * @property {string} type the name a genome's voice gives in `type`
 * @property {string} description one line for the schema text
 * @property {DescriptorTable} params the voice's own parameters, beside the common ones every
 *   voice has
 * @property {readonly MacroRow[]} macros the macro rows on the voice's own parameters and the
 *   common ones, which the macro table adds to its global rows (decision 0006)
 */

/** @type {VoiceType[]} */
const builtIn = [];

/** @type {Map<string, VoiceType>} */
const voices = new Map();

/**
 * Adds a voice type, or throws when its type is taken, a parameter shadows a common one, or a
 * macro row is invalid.
 * @template {VoiceType} V
 * @param {V} voice
 * @returns {V}
 */
export function registerVoice(voice) {
  if (voices.has(voice.type)) throw new Error(`voice type "${voice.type}" is already registered`);
  for (const name of Object.keys(voice.params)) {
    if (Object.hasOwn(VOICE_PARAMS, name) || VOICE_KEYS.includes(name)) {
      throw new Error(`voice type "${voice.type}": "${name}" is a parameter every voice has`);
    }
  }
  checkMacroRows(voice.macros, { ...VOICE_PARAMS, ...voice.params }, `voice type "${voice.type}"`);
  voices.set(voice.type, voice);
  return voice;
}

/**
 * Removes a voice type, so a test's fixture doesn't outlive the file that registered it.
 * @param {string} type
 */
export function unregisterVoice(type) {
  if (!voices.delete(type)) throw new Error(`voice type "${type}" is not registered`);
}

for (const voice of builtIn) registerVoice(voice);

/** @returns {string[]} every registered voice type, sorted */
export const voiceTypeIds = () => [...voices.keys()].sort();

/**
 * @param {string} type
 * @returns {VoiceType | undefined}
 */
export const findVoiceType = (type) => voices.get(type);

/**
 * The voice type for a type the caller already knows is registered, as in a validated genome.
 * @param {string} type
 * @returns {VoiceType}
 */
export function requireVoiceType(type) {
  const voice = voices.get(type);
  if (!voice) throw new Error(`voice type "${type}" is not registered`);
  return voice;
}

/**
 * Every parameter a voice of a registered type has: the common ones and the type's own.
 * @param {string} type
 * @returns {DescriptorTable}
 */
export const voiceParams = (type) => ({ ...VOICE_PARAMS, ...requireVoiceType(type).params });

// Every voice type the engine knows. A voice module is added with one import line here and its
// name in `builtIn`; the schema, the macro table and `randomGenome` read voices from this module
// only. Tests register the fixture voice from test/support/ in `beforeAll` and unregister it in
// `afterAll`, so this file never imports test code (decision 0005).
/** @import { DescriptorTable } from "./descriptor.js" */
import { VOICE_KEYS, VOICE_PARAMS } from "./genome-schema.js";

/**
 * @typedef {object} VoiceType
 * @property {string} type the name a genome's voice gives in `type`
 * @property {string} description one line for the schema text
 * @property {DescriptorTable} params the voice's own parameters, beside the common ones every
 *   voice has
 */

/** @type {VoiceType[]} */
const builtIn = [];

/** @type {Map<string, VoiceType>} */
const voices = new Map();

/**
 * Adds a voice type, or throws when its type is taken or a parameter shadows a common one.
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

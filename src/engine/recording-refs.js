// Where a genome names field recordings: every `recording` parameter of its voices (decision
// 0029). The server reads it to know which files to decode, and generation to check each hash
// against the recordings it listed.
/** @import { Genome } from "./genome-schema.js" */
import { isRecording } from "./descriptor.js";
import { voiceParams } from "./voice-registry.js";

/**
 * @typedef {object} RecordingRef
 * @property {string} path the parameter's JSONPath, as validation errors give it
 * @property {string} hash
 */

/**
 * @param {Genome} genome normalized
 * @returns {RecordingRef[]} in voice order
 */
export function recordingRefs(genome) {
  return genome.voices.flatMap((voice, i) =>
    Object.entries(voiceParams(voice.type)).flatMap(([name, descriptor]) =>
      isRecording(descriptor)
        ? [{ path: `$.voices[${i}].${name}`, hash: /** @type {string} */ (voice[name]) }]
        : [],
    ),
  );
}

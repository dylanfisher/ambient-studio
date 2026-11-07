// The field recordings the prompt offers the LLM, with the recording voice's schema lines
// (decision 0029). Without a recording the voice can't be written, so an empty list gives no
// text and the prompt reads as it did before the voice existed.
import { unplayable } from "../engine/field-recording.js";
import { recordingVoiceText } from "../engine/schema-text.js";

/**
 * A recording as the server's index lists it.
 * @typedef {object} RecordingListing
 * @property {string} file its path in the recordings folder
 * @property {string} hash SHA-256 of the file, which a genome names it by
 * @property {number} duration seconds
 * @property {number} channels
 * @property {number} sampleRate Hz
 */

/**
 * Most recordings the prompt lists. Each line is about 100 characters, so 32 take about 900 of
 * the 8,192-token budget.
 */
export const MAX_PROMPT_RECORDINGS = 32;

/**
 * The text the system message adds after the schema: the voice's lines and one line per
 * playable recording, in the index's order, at most `MAX_PROMPT_RECORDINGS`. Empty when none
 * is playable.
 * @param {readonly RecordingListing[]} recordings
 * @returns {string}
 */
export function recordingsText(recordings) {
  const playable = recordings.filter((r) => unplayable(r) === null);
  if (playable.length === 0) return "";
  const listed = playable.slice(0, MAX_PROMPT_RECORDINGS);
  const count =
    listed.length < playable.length ? `the first ${listed.length} of ${playable.length}` : "all";
  return [
    "A voice may also play one of the owner's field recordings:",
    recordingVoiceText(),
    `Recordings (${count}): sha256, seconds, channels, file`,
    ...listed.map(
      ({ hash, duration, channels, file }) =>
        `${hash} ${Math.round(duration * 10) / 10} ${channels} ${JSON.stringify(file)}`,
    ),
  ].join("\n");
}

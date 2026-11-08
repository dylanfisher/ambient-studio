// ffmpeg is the one decoder of reference uploads (decision 0050): node-web-audio-api's
// decodeAudioData was measured on WAV, FLAC and AIFF only (0029), and references also come as
// MP3, AAC, ALAC, Vorbis and Opus. Arguments go to execFile as an array, and the only path
// passed is one the server made, so nothing the owner typed reaches ffmpeg.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SAMPLE_RATE } from "../engine/render-plan.js";

const run = promisify(execFile);

/** The ffmpeg CLI, found on PATH like flac (0012). */
export const FFMPEG = "ffmpeg";

/**
 * The demuxers ffmpeg may use on a reference, given to every call as `-format_whitelist`, so a
 * file that is really a playlist or a concat list can't make ffmpeg open other files.
 */
export const DEMUXERS = Object.freeze(["wav", "aiff", "flac", "mp3", "mov", "ogg"]);

/** The rate a region decodes at: the render's and the meter's (0008). */
export const DECODE_RATE = SAMPLE_RATE;

/** Bytes per float sample on ffmpeg's stdout. */
const F32_BYTES = 4;
/** A region always decodes to two channels: a mono file plays in both, as 0029's voice does. */
const CHANNELS = 2;

/**
 * The arguments that open a reference for reading, before any output options.
 * @param {string} path
 */
export const inputArgs = (path) => [
  ...["-nostdin", "-hide_banner", "-v", "error"],
  ...["-format_whitelist", DEMUXERS.join(","), "-i", path],
];

/**
 * @typedef {object} Decoded
 * @property {number} sampleRate always `DECODE_RATE`
 * @property {Float32Array[]} channels two of equal length
 */

/**
 * Decodes `start` to `end` seconds of a reference file as 48 kHz stereo floats. `-ss` and `-t`
 * come after `-i`, so ffmpeg decodes from the start and drops what comes before `start`: slower
 * than seeking in the input, but exact to the frame in every format. Throws when ffmpeg fails,
 * and when it gives other than the frames the bounds name, as it does past the file's end.
 * @param {string} path
 * @param {number} start seconds
 * @param {number} end seconds, after `start`
 * @returns {Promise<Decoded>}
 */
export async function decodeWithFfmpeg(path, start, end) {
  if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start)) {
    throw new Error(`a region needs 0 <= start < end, got start ${start} and end ${end}`);
  }
  const output = ["-ss", String(start), "-t", String(end - start)];
  const format = ["-f", "f32le", "-ac", String(CHANNELS), "-ar", String(DECODE_RATE), "-"];
  const { stdout } = await run(FFMPEG, [...inputArgs(path), ...output, ...format], {
    encoding: "buffer",
    maxBuffer: Number.POSITIVE_INFINITY,
  });
  const frames = stdout.length / (F32_BYTES * CHANNELS);
  const expected = Math.round((end - start) * DECODE_RATE);
  if (frames !== expected) {
    throw new Error(
      `decoding ${start} s to ${end} s of ${path} gave ${frames} frames, not the ${expected} the bounds name`,
    );
  }
  // Copied, not viewed: a Buffer's offset into its pool needn't be a multiple of 4.
  const interleaved = new Float32Array(new Uint8Array(stdout).buffer);
  const channels = Array.from({ length: CHANNELS }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (const [c, channel] of channels.entries()) {
      channel[i] = /** @type {number} */ (interleaved[i * CHANNELS + c]);
    }
  }
  return { sampleRate: DECODE_RATE, channels };
}

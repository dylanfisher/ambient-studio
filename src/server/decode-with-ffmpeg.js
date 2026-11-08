// ffmpeg is the one decoder of reference uploads (decision 0050): node-web-audio-api's
// decodeAudioData was measured on WAV, FLAC and AIFF only (0029), and references also come as
// MP3, AAC, ALAC, Vorbis and Opus. Arguments go to execFile as an array, and the only path
// passed is one the server made, so nothing the owner typed reaches ffmpeg.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { DEMUXERS } from "./reference-formats.js";

const run = promisify(execFile);

/** The ffmpeg CLI, found on PATH like flac (0012). */
export const FFMPEG = "ffmpeg";

/** The rate a region decodes at: the render's and the meter's (0008). */
export const DECODE_RATE = SAMPLE_RATE;

/** Bytes per float sample on ffmpeg's stdout. */
const F32_BYTES = 4;
/** A region always decodes to two channels: a mono file plays in both, as 0029's voice does. */
const CHANNELS = 2;

/**
 * How long each ffmpeg or ffprobe call may run before it is killed, in milliseconds: a probe;
 * a region's decode, at most 5 minutes of audio; and the peak strip's decode of up to an hour.
 */
export const FFMPEG_TIMEOUT_MS = Object.freeze({ probe: 30_000, region: 60_000, peaks: 300_000 });

/**
 * The most a region ending at the file's end may come up short, in seconds. ffprobe's length
 * for MP3, AAC and Opus is an estimate: an Opus fixture probed 6.5 ms longer than it decodes.
 * A shortfall up to this is padded with silence, so a region always holds the frames its
 * bounds name; a larger one throws.
 */
export const END_SLACK_SECONDS = 0.1;

/**
 * The options ffmpeg and ffprobe both take before a reference's path: errors only, local files
 * only, and only the accepted formats' demuxers, so a file that is really a playlist or a
 * concat list can't make either open other files or URLs.
 */
export const READ_OPTIONS = Object.freeze([
  ...["-hide_banner", "-v", "error", "-protocol_whitelist", "file"],
  ...["-format_whitelist", DEMUXERS.join(",")],
]);

/**
 * The arguments that open a reference for ffmpeg to decode, before any output options.
 * @param {string} path
 */
export const inputArgs = (path) => ["-nostdin", ...READ_OPTIONS, "-i", path];

/**
 * The output options that write raw stereo floats to stdout at `rate`.
 * @param {number} rate
 */
export const rawStereoArgs = (rate) => [
  "-f",
  "f32le",
  "-ac",
  String(CHANNELS),
  "-ar",
  String(rate),
  "-",
];

/**
 * @typedef {object} Decoded
 * @property {number} sampleRate always `DECODE_RATE`
 * @property {Float32Array[]} channels two of equal length
 */

/**
 * Decodes `start` to `end` seconds of a reference file as 48 kHz stereo floats. `-ss` and `-t`
 * come after `-i`, so ffmpeg decodes from the start and drops what comes before `start`: slower
 * than seeking in the input, but exact to the frame in every format. An input seek was measured
 * short by 352 frames on AAC and gave other samples on MP3 and Vorbis. Throws when ffmpeg
 * fails, and when it gives more frames than the bounds name, or more than `END_SLACK_SECONDS`
 * fewer; a smaller shortfall, at the file's end, is padded with silence.
 * @param {string} path
 * @param {number} start seconds
 * @param {number} end seconds, after `start`
 * @param {AbortSignal} [signal] kills ffmpeg when it aborts, so a cancelled job stops at once
 * @returns {Promise<Decoded>}
 */
export async function decodeWithFfmpeg(path, start, end, signal) {
  if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start)) {
    throw new Error(`a region needs 0 <= start < end, got start ${start} and end ${end}`);
  }
  const output = ["-ss", String(start), "-t", String(end - start)];
  const { stdout } = await run(
    FFMPEG,
    [...inputArgs(path), ...output, ...rawStereoArgs(DECODE_RATE)],
    {
      encoding: "buffer",
      maxBuffer: Number.POSITIVE_INFINITY,
      timeout: FFMPEG_TIMEOUT_MS.region,
      ...(signal && { signal }),
    },
  );
  const decoded = stdout.length / (F32_BYTES * CHANNELS);
  const frames = Math.round((end - start) * DECODE_RATE);
  const short = frames - decoded;
  if (short < 0 || short > END_SLACK_SECONDS * DECODE_RATE) {
    throw new Error(
      `decoding ${start} s to ${end} s of ${path} gave ${decoded} frames, not the ${frames} the bounds name`,
    );
  }
  // Copied, not viewed: a Buffer's offset into its pool needn't be a multiple of 4.
  const interleaved = new Float32Array(new Uint8Array(stdout).buffer);
  const channels = Array.from({ length: CHANNELS }, () => new Float32Array(frames));
  for (let i = 0; i < decoded; i++) {
    for (const [c, channel] of channels.entries()) {
      channel[i] = /** @type {number} */ (interleaved[i * CHANNELS + c]);
    }
  }
  return { sampleRate: DECODE_RATE, channels };
}

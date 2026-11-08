// Reads an uploaded file's shape with ffprobe and decides whether it is a reference the studio
// keeps (decision 0050): an accepted format, 10 s to 60 min, mono or stereo, one audio stream.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { READ_OPTIONS } from "./decode-with-ffmpeg.js";
import { ACCEPTED_FORMATS, FORMATS_TEXT } from "./reference-formats.js";

const run = promisify(execFile);

/** The ffprobe CLI, installed with ffmpeg. */
const FFPROBE = "ffprobe";

/** The shortest and longest reference, in seconds. */
const REFERENCE_SECONDS = Object.freeze({ min: 10, max: 3600 });

/** The channel counts a reference may have. */
const CHANNEL_COUNTS = Object.freeze([1, 2]);

/**
 * @typedef {object} Probed
 * @property {string} format an `ACCEPTED_FORMATS` key
 * @property {string} extension
 * @property {number} durationSeconds
 * @property {number} channels
 * @property {number} sampleRate
 */

/**
 * The upload's shape, or the sentence that says why it isn't kept. A file ffprobe can't read
 * with the accepted demuxers isn't audio the studio reads; any other ffprobe failure throws.
 * @param {string} path a file the server wrote
 * @returns {Promise<{ ok: true, probed: Probed } | { ok: false, reason: string }>}
 */
export async function probeReference(path) {
  const notAudio = {
    ok: /** @type {const} */ (false),
    reason: `The file isn't audio in a format the studio reads: ${FORMATS_TEXT}.`,
  };
  const entries = "format=format_name,duration:stream=codec_type,codec_name,channels,sample_rate";
  /** @type {string} */
  let stdout;
  try {
    ({ stdout } = await run(FFPROBE, [
      ...READ_OPTIONS,
      ...["-show_entries", entries, "-of", "json", "-i", path],
    ]));
  } catch (error) {
    // ffprobe exits 1 with "Invalid data found" for a file no allowed demuxer reads.
    if (/** @type {{ code?: unknown }} */ (error).code === 1) return notAudio;
    throw error;
  }
  const { format: container, streams = [] } = JSON.parse(stdout);
  const demuxer = String(container?.format_name ?? "").split(",")[0];
  const audio = streams.filter((/** @type {any} */ stream) => stream.codec_type === "audio");
  if (audio.length !== 1) {
    return {
      ok: false,
      reason: `The file has ${audio.length} audio streams; a reference has one.`,
    };
  }
  const [stream] = audio;
  const entry = Object.entries(ACCEPTED_FORMATS).find(
    ([, format]) => format.demuxer === demuxer && format.codec(String(stream.codec_name)),
  );
  if (!entry) return notAudio;
  const [format, { extension }] = entry;
  const durationSeconds = Number(container.duration);
  if (!Number.isFinite(durationSeconds)) {
    return { ok: false, reason: "ffprobe couldn't read how long the file is." };
  }
  if (durationSeconds < REFERENCE_SECONDS.min || durationSeconds > REFERENCE_SECONDS.max) {
    return {
      ok: false,
      reason: `The file is ${durationSeconds.toFixed(1)} seconds long; a reference must be ${REFERENCE_SECONDS.min} seconds to ${REFERENCE_SECONDS.max / 60} minutes.`,
    };
  }
  const channels = Number(stream.channels);
  if (!CHANNEL_COUNTS.includes(channels)) {
    return {
      ok: false,
      reason: `The file has ${channels} channels; a reference must be mono or stereo.`,
    };
  }
  const sampleRate = Number(stream.sample_rate);
  return { ok: true, probed: { format, extension, durationSeconds, channels, sampleRate } };
}

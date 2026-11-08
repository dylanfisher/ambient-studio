// The formats a reference upload may be in (decision 0050), as ffprobe names them: the demuxer
// that reads the container and the codecs it may hold. The extension a kept file gets comes
// from here, never from the owner's file name.

/**
 * @typedef {object} ReferenceFormat
 * @property {string} demuxer ffmpeg's name for the container's demuxer, the first of the names
 *   ffprobe lists for it
 * @property {(codec: string) => boolean} codec whether the audio stream's codec is this format
 * @property {string} extension the kept file's, with its dot
 * @property {string} label how the page and errors name it
 */

/** @param {readonly string[]} names */
const oneOf = (names) => (/** @type {string} */ codec) => names.includes(codec);
/** WAV and AIFF hold integer or float PCM, which ffmpeg names `pcm_s16le`, `pcm_f32be`… */
const pcm = (/** @type {string} */ codec) => codec.startsWith("pcm_");

/** @type {Readonly<Record<string, ReferenceFormat>>} */
export const ACCEPTED_FORMATS = Object.freeze({
  wav: { demuxer: "wav", codec: pcm, extension: ".wav", label: "WAV" },
  aiff: { demuxer: "aiff", codec: pcm, extension: ".aiff", label: "AIFF" },
  flac: { demuxer: "flac", codec: oneOf(["flac"]), extension: ".flac", label: "FLAC" },
  mp3: { demuxer: "mp3", codec: oneOf(["mp3"]), extension: ".mp3", label: "MP3" },
  aac: { demuxer: "mov", codec: oneOf(["aac"]), extension: ".m4a", label: "AAC in M4A" },
  alac: { demuxer: "mov", codec: oneOf(["alac"]), extension: ".m4a", label: "ALAC in M4A" },
  vorbis: { demuxer: "ogg", codec: oneOf(["vorbis"]), extension: ".ogg", label: "Ogg Vorbis" },
  opus: { demuxer: "ogg", codec: oneOf(["opus"]), extension: ".opus", label: "Opus" },
});

/** Every demuxer the accepted formats use, each once. */
export const DEMUXERS = Object.freeze([
  ...new Set(Object.values(ACCEPTED_FORMATS).map((format) => format.demuxer)),
]);

/** The accepted formats in words, for an error that says what the studio reads. */
export const FORMATS_TEXT = Object.values(ACCEPTED_FORMATS)
  .map((format) => format.label)
  .join(", ");

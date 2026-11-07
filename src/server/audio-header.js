// Reads a WAV, AIFF or FLAC file's channels, sample rate and length from its header, for the
// recordings index (decision 0029). Decoding the whole file only to list it would hold every
// recording in memory at once at 48 kHz floats, and `decodeAudioData` resamples, so the file's
// own rate isn't in what it returns.

/**
 * @typedef {object} AudioHeader
 * @property {"wav" | "aiff" | "flac"} format
 * @property {number} channels
 * @property {number} sampleRate Hz
 * @property {number} frames
 */

/**
 * @param {Buffer} bytes
 * @param {number} at
 * @param {string} id
 */
const tagAt = (bytes, at, id) => bytes.toString("latin1", at, at + id.length) === id;

/**
 * Whether a chunk of `size` bytes at `at`, after its 8-byte id and size, lies inside `bytes`. A
 * chunk that claims to run past the file is not read.
 * @param {Buffer} bytes
 * @param {number} at
 * @param {number} size
 */
const fits = (bytes, at, size) => at + 8 + size <= bytes.length;

/**
 * A RIFF WAVE file: its `fmt ` chunk, and the `data` chunk's size over the frame size.
 * @param {Buffer} bytes
 * @returns {AudioHeader | undefined}
 */
function wavHeader(bytes) {
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = bytes.readUInt32LE(at + 4);
    if (tagAt(bytes, at, "fmt ") && size >= 16 && fits(bytes, at, size)) {
      channels = bytes.readUInt16LE(at + 10);
      sampleRate = bytes.readUInt32LE(at + 12);
      blockAlign = bytes.readUInt16LE(at + 20);
    } else if (tagAt(bytes, at, "data") && blockAlign > 0) {
      return { format: "wav", channels, sampleRate, frames: Math.floor(size / blockAlign) };
    }
    // Chunks are padded to an even size.
    at += 8 + size + (size % 2);
  }
  return undefined;
}

/**
 * An 80-bit IEEE extended float, as AIFF stores its sample rate.
 * @param {Buffer} bytes
 * @param {number} at
 */
function extended(bytes, at) {
  const exponent = bytes.readUInt16BE(at) & 0x7fff;
  const mantissa = bytes.readBigUInt64BE(at + 2);
  return Number(mantissa) * 2 ** (exponent - 16383 - 63);
}

/**
 * An AIFF or AIFF-C file: its `COMM` chunk.
 * @param {Buffer} bytes
 * @returns {AudioHeader | undefined}
 */
function aiffHeader(bytes) {
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = bytes.readUInt32BE(at + 4);
    if (tagAt(bytes, at, "COMM") && size >= 18 && fits(bytes, at, size)) {
      return {
        format: "aiff",
        channels: bytes.readUInt16BE(at + 8),
        frames: bytes.readUInt32BE(at + 10),
        sampleRate: extended(bytes, at + 16),
      };
    }
    at += 8 + size + (size % 2);
  }
  return undefined;
}

/**
 * A FLAC file: its STREAMINFO block, which the format requires first.
 * @param {Buffer} bytes
 * @returns {AudioHeader | undefined}
 */
function flacHeader(bytes) {
  // "fLaC", then a 4-byte block header, then 10 bytes of block and frame sizes.
  const at = 18;
  if (bytes.length < at + 8 || ((bytes[4] ?? 0) & 0x7f) !== 0) return undefined;
  const bits = bytes.readBigUInt64BE(at);
  return {
    format: "flac",
    sampleRate: Number(bits >> 44n),
    channels: Number((bits >> 41n) & 0x7n) + 1,
    frames: Number(bits & 0xfffffffffn),
  };
}

/**
 * The header of a WAV, AIFF or FLAC file. Throws, naming the file, when the bytes are none of
 * them or the header gives no channels, rate or length.
 * @param {Buffer} bytes the file, or at least its header
 * @param {string} name for the error message
 * @returns {AudioHeader}
 */
export function readAudioHeader(bytes, name) {
  let header;
  if (tagAt(bytes, 0, "RIFF") && tagAt(bytes, 8, "WAVE")) header = wavHeader(bytes);
  else if (tagAt(bytes, 0, "FORM") && (tagAt(bytes, 8, "AIFF") || tagAt(bytes, 8, "AIFC")))
    header = aiffHeader(bytes);
  else if (tagAt(bytes, 0, "fLaC")) header = flacHeader(bytes);
  else throw new Error(`${name} isn't a WAV, AIFF or FLAC file`);
  const usable = (/** @type {AudioHeader} */ h) =>
    h.channels > 0 && h.sampleRate > 0 && Number.isFinite(h.sampleRate) && h.frames > 0;
  if (!header || !usable(header)) {
    throw new Error(`${name}: can't read its channels, sample rate and length from the header`);
  }
  return header;
}

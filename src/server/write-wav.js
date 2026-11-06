import { open } from "node:fs/promises";
import { PCM24_BYTES } from "./encode-pcm24.js";

const HEADER_BYTES = 44;
// The RIFF size field is 32 bits and counts everything after its own 8-byte chunk header.
const MAX_DATA_BYTES = 2 ** 32 - 1 - (HEADER_BYTES - 8) - 1;

/**
 * @typedef {object} WavFormat
 * @property {number} channelCount
 * @property {number} sampleRate
 */

/**
 * Writes a 24-bit PCM WAV: a plain 44-byte header (format tag 1, not WAVE_FORMAT_EXTENSIBLE)
 * followed by the PCM, plus a pad byte when the data size is odd.
 * @param {string} path
 * @param {Uint8Array} pcm interleaved 24-bit PCM from `encodePcm24`
 * @param {WavFormat} format
 */
export async function writeWav(path, pcm, { channelCount, sampleRate }) {
  const blockAlign = channelCount * PCM24_BYTES;
  if (pcm.length % blockAlign !== 0) {
    throw new Error(`${pcm.length} bytes of PCM aren't whole frames of ${blockAlign} bytes`);
  }
  if (pcm.length > MAX_DATA_BYTES) {
    throw new Error(`${pcm.length} bytes of PCM exceed the WAV limit of ${MAX_DATA_BYTES}`);
  }
  const pad = pcm.length % 2;
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(HEADER_BYTES - 8 + pcm.length + pad, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM24_BYTES * 8, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.length, 40);
  const file = await open(path, "w");
  try {
    await file.writev(pad ? [header, pcm, new Uint8Array(1)] : [header, pcm]);
  } finally {
    await file.close();
  }
}

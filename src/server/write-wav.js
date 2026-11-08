import { createWavWriter, PCM24 } from "./wav-writer.js";

/**
 * @typedef {object} WavFormat
 * @property {number} channelCount
 * @property {number} sampleRate
 */

/**
 * Writes a 24-bit PCM WAV: a plain 44-byte header (format tag 1, not WAVE_FORMAT_EXTENSIBLE)
 * followed by the PCM, plus a pad byte when the data size is odd. `createWavWriter` with the
 * whole PCM as one chunk. Throws rather than overwrite an existing file.
 * @param {string} path
 * @param {Uint8Array} pcm interleaved 24-bit PCM from `encodePcm24`
 * @param {WavFormat} format
 */
export async function writeWav(path, pcm, { channelCount, sampleRate }) {
  // A length that isn't whole frames is refused by `append`, which removes the file.
  const frames = Math.floor(pcm.length / (channelCount * PCM24.bytes));
  const writer = await createWavWriter(path, {
    channelCount,
    sampleRate,
    frames,
    sampleFormat: PCM24,
  });
  await writer.append(pcm);
  await writer.close();
}

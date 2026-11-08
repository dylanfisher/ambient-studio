import { open, rm } from "node:fs/promises";
import { FLOAT32_BYTES } from "./encode-float32.js";
import { PCM24_BYTES } from "./encode-pcm24.js";

/**
 * A WAV sample format: its format tag, bytes a sample, and header layout.
 * @typedef {object} SampleFormat
 * @property {number} tag
 * @property {number} bytes
 * @property {number} fmtBytes the fmt chunk's size
 * @property {boolean} fact whether the header has a fact chunk
 */

/**
 * 0012's export format, from `encodePcm24`, with the plain 44-byte header.
 * @type {Readonly<SampleFormat>}
 */
export const PCM24 = Object.freeze({ tag: 1, bytes: PCM24_BYTES, fmtBytes: 16, fact: false });

/**
 * For stems, which can pass 0 dBFS (0060), from `encodeFloat32`. A non-PCM tag, so the header
 * has the 18-byte fmt chunk with a zero extension size and a fact chunk holding the frame
 * count, as the WAV format asks of every non-PCM tag: 58 bytes.
 * @type {Readonly<SampleFormat>}
 */
export const FLOAT32 = Object.freeze({ tag: 3, bytes: FLOAT32_BYTES, fmtBytes: 18, fact: true });

// The RIFF size field is 32 bits and counts everything after its own 8-byte chunk header.
const MAX_RIFF_BYTES = 2 ** 32 - 1;

/**
 * @typedef {object} WavStream
 * @property {number} channelCount
 * @property {number} sampleRate
 * @property {number} frames the total the header states; `close` refuses any other
 * @property {Readonly<SampleFormat>} sampleFormat `PCM24` or `FLOAT32`
 */

/**
 * @typedef {object} WavWriter
 * @property {(bytes: Uint8Array) => Promise<void>} append the next whole frames, interleaved, as
 *   the sample format's encoder gives them
 * @property {() => Promise<void>} close checks the total and closes the file
 * @property {() => Promise<void>} abort closes and removes the file
 */

/**
 * Opens a WAV whose header states `frames` up front, then takes its samples in chunks, so a
 * long render is never held whole. Throws rather than overwrite an existing file. A chunk
 * past the stated total, or a total short of it at `close`, removes the file and throws, so no
 * file is left whose header disagrees with its data.
 * @param {string} path
 * @param {WavStream} stream
 * @returns {Promise<WavWriter>}
 */
export async function createWavWriter(path, { channelCount, sampleRate, frames, sampleFormat }) {
  const format = sampleFormat;
  if (!Number.isSafeInteger(frames) || frames < 0) {
    throw new Error(`a WAV's frame count must be a whole number, got ${frames}`);
  }
  const blockAlign = channelCount * format.bytes;
  const dataBytes = frames * blockAlign;
  const pad = dataBytes % 2;
  const header = wavHeader(format, { channelCount, sampleRate, frames, blockAlign, pad });
  if (header.length - 8 + dataBytes + pad > MAX_RIFF_BYTES) {
    throw new Error(`${dataBytes} bytes of PCM exceed the WAV limit of ${MAX_RIFF_BYTES} bytes`);
  }
  const file = await open(path, "wx");
  let written = 0;
  let isOpen = true;

  async function remove() {
    if (!isOpen) return;
    isOpen = false;
    await file.close();
    await rm(path, { force: true });
  }

  /** @param {Error} error */
  async function fail(error) {
    await remove();
    throw error;
  }

  /**
   * A positioned write, so frames land in order even if appends overlap. A failed write, such
   * as on a full disk, removes the file like any other refusal.
   * @param {Uint8Array} bytes
   * @param {number} at
   */
  async function writeAt(bytes, at) {
    try {
      await file.write(bytes, 0, bytes.length, at);
    } catch (error) {
      await fail(/** @type {Error} */ (error));
    }
  }

  await writeAt(header, 0);

  return {
    async append(bytes) {
      if (!isOpen) throw new Error(`${path} is already closed`);
      if (bytes.length % blockAlign !== 0) {
        await fail(
          new Error(`${bytes.length} bytes of PCM aren't whole frames of ${blockAlign} bytes`),
        );
      }
      const after = written + bytes.length;
      if (after > dataBytes) {
        await fail(
          new Error(
            `${path}: ${after / blockAlign} frames is more than the ${frames} its header states`,
          ),
        );
      }
      const at = header.length + written;
      written = after;
      await writeAt(bytes, at);
    },
    async close() {
      if (!isOpen) throw new Error(`${path} is already closed`);
      if (written !== dataBytes) {
        await fail(
          new Error(
            `${path}: got ${written / blockAlign} of the ${frames} frames its header states`,
          ),
        );
      }
      if (pad) await writeAt(new Uint8Array(1), header.length + dataBytes);
      isOpen = false;
      await file.close();
    },
    abort: remove,
  };
}

/**
 * @param {Readonly<SampleFormat>} format
 * @param {{ channelCount: number, sampleRate: number, frames: number, blockAlign: number,
 *   pad: number }} layout
 */
function wavHeader(format, { channelCount, sampleRate, frames, blockAlign, pad }) {
  const dataBytes = frames * blockAlign;
  const factBytes = format.fact ? 12 : 0;
  const header = Buffer.alloc(12 + 8 + format.fmtBytes + factBytes + 8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(header.length - 8 + dataBytes + pad, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(format.fmtBytes, 16);
  header.writeUInt16LE(format.tag, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bytes * 8, 34);
  // Buffer.alloc zeroes, so an 18-byte fmt chunk's extension size is already 0.
  let at = 20 + format.fmtBytes;
  if (format.fact) {
    header.write("fact", at, "latin1");
    header.writeUInt32LE(4, at + 4);
    header.writeUInt32LE(frames, at + 8);
    at += factBytes;
  }
  header.write("data", at, "latin1");
  header.writeUInt32LE(dataBytes, at + 4);
  return header;
}

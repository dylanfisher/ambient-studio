// Reading the MP3s the render cache holds (decision 0048): each frame's header, walked from the
// start of the file, and the samples `lame --decode` gives back.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** MPEG-1 Layer III bit rates by header index, in kbps. */
const KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
/** MPEG-1 sample rates by header index. */
const RATES = [44100, 48000, 32000];
/** The channel mode a mono frame's header gives. */
const MONO = 3;

/**
 * @typedef {object} Mp3Frame
 * @property {number} kbps
 * @property {number} sampleRate
 * @property {number} channels
 */

/**
 * Every frame's header, from a file of MPEG-1 Layer III frames with no ID3 tag, as lame writes
 * it with no tags given. Throws at the first byte that doesn't start a frame.
 * @param {Buffer} file
 * @returns {Mp3Frame[]}
 */
export function mp3Frames(file) {
  /** @type {Mp3Frame[]} */
  const frames = [];
  for (let at = 0; at < file.length; ) {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = file.subarray(at, at + 4);
    const version = (b1 >> 3) & 3;
    const layer = (b1 >> 1) & 3;
    const kbps = KBPS[b2 >> 4];
    const sampleRate = RATES[(b2 >> 2) & 3];
    if (
      b0 !== 0xff ||
      (b1 & 0xe0) !== 0xe0 ||
      version !== 3 ||
      layer !== 1 ||
      !kbps ||
      !sampleRate
    ) {
      throw new Error(`no MPEG-1 Layer III frame at byte ${at} of ${file.length}`);
    }
    frames.push({ kbps, sampleRate, channels: b3 >> 6 === MONO ? 1 : 2 });
    at += Math.floor((144 * kbps * 1000) / sampleRate) + ((b2 >> 1) & 1);
  }
  return frames;
}

/**
 * The samples of an MP3, decoded by `lame --decode` to 16-bit PCM. lame drops the encoder's
 * delay and padding by the file's LAME tag, so the length is the length encoded.
 * @param {string} path
 * @returns {Promise<Float32Array[]>} one array per channel
 */
export async function decodeMp3(path) {
  const dir = await mkdtemp(join(tmpdir(), "decode-mp3-"));
  try {
    const wavPath = join(dir, "decoded.wav");
    await run("lame", ["--decode", "--silent", path, wavPath]);
    const wav = await readFile(wavPath);
    const channelCount = wav.readUInt16LE(22);
    const data = wav.subarray(44, 44 + wav.readUInt32LE(40));
    const frames = data.length / (2 * channelCount);
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    for (let i = 0; i < frames; i++) {
      for (const [c, channel] of channels.entries()) {
        channel[i] = data.readInt16LE((i * channelCount + c) * 2) / 32768;
      }
    }
    return channels;
  } finally {
    await rm(dir, { recursive: true });
  }
}

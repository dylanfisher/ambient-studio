// Decodes the field recordings a genome names into the `samples` a render takes (decision
// 0029): each file found in the index by its SHA-256, read, hashed again so a file edited since
// it was indexed fails rather than playing other audio, and decoded at the render's rate.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Recording, Samples } from "../engine/render.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
import { readFile, stat } from "node:fs/promises";
import { OfflineAudioContext } from "node-web-audio-api";
import { unplayable } from "../engine/field-recording.js";
import { recordingRefs } from "../engine/recording-refs.js";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { sha256Hex } from "./sha256-hex.js";

/** The largest file `readFile` reads: above it, it throws ERR_FS_FILE_TOO_LARGE. */
const MAX_FILE_BYTES = 2 ** 31 - 1;

/**
 * Decodes a WAV, FLAC or AIFF file's bytes at the render's sample rate. `decodeAudioData`
 * resamples a file at another rate; the same bytes decode to the same samples every time.
 * @param {Uint8Array} bytes
 * @returns {Promise<Recording>}
 */
export async function decodeRecording(bytes) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: SAMPLE_RATE });
  // decodeAudioData takes an ArrayBuffer of its own, which it may detach.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const buffer = await ctx.decodeAudioData(/** @type {ArrayBuffer} */ (copy));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c).slice(),
  );
  return { sampleRate: buffer.sampleRate, channels };
}

/**
 * The samples every recording voice of `genome` plays. Throws, naming the file, when no file in
 * the index has a hash the genome names, when an indexed file's bytes no longer hash to it, or
 * when the voice can't play the file.
 * @param {Genome} genome normalized
 * @param {readonly RecordingEntry[] | undefined} index the recordings folder's; may be undefined
 *   only for a genome that plays no recording
 * @param {Readonly<Record<string, string>>} [names] file names by hash from where the genome came
 *   from, such as an export's sidecar, for the message when a file is gone from the index
 * @returns {Promise<{ samples: Samples; files: Record<string, string> }>} the decoded
 *   recordings, and each one's file in the folder, both by hash
 */
export async function loadSamples(genome, index, names = {}) {
  /** @type {Record<string, Recording>} */
  const samples = {};
  /** @type {Record<string, string>} */
  const files = {};
  for (const { path, hash } of recordingRefs(genome)) {
    if (Object.hasOwn(samples, hash)) continue;
    if (!index) {
      throw new Error(`${path} plays a field recording, and no recordings folder was given`);
    }
    const entry = index.find((e) => e.hash === hash);
    if (!entry) {
      const name = Object.hasOwn(names, hash) ? `${names[hash]} ` : "";
      throw new Error(
        `${path}: recording ${name}(sha256 ${hash}) is in no file of the recordings folder; it was moved out, deleted or edited`,
      );
    }
    const problem = unplayable(entry);
    if (problem) throw new Error(`${path}: can't play ${entry.path}: ${problem}`);
    const { size } = await stat(entry.path);
    if (size > MAX_FILE_BYTES) {
      throw new Error(
        `${path}: can't play ${entry.path}: it is ${size} bytes, over the ${MAX_FILE_BYTES} a file may be read in`,
      );
    }
    const bytes = await readFile(entry.path);
    const now = sha256Hex(bytes);
    if (now !== hash) {
      throw new Error(
        `${path}: ${entry.path} changed since it was indexed: its sha256 is ${now}, and the genome names ${hash}`,
      );
    }
    const decoded = await decodeRecording(bytes);
    // The header can understate the data: the decoder reads every frame the data chunk holds.
    const frames = /** @type {Float32Array} */ (decoded.channels[0]).length;
    const shape = { channels: decoded.channels.length, duration: frames / decoded.sampleRate };
    const decodedProblem = unplayable(shape);
    if (decodedProblem) {
      throw new Error(`${path}: can't play ${entry.path}: decoded, ${decodedProblem}`);
    }
    samples[hash] = decoded;
    files[hash] = entry.file;
  }
  return { samples, files };
}

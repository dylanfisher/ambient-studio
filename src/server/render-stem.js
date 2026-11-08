// One stem of a track (decision 0063): the track's mix through `mixTrack`, with each section's
// render limited to the stem's voices, scaled by the mix's normalize gain and never limited,
// streamed into a 32-bit float WAV whose data is hashed as it is written. It holds one chunk and
// one crossfade at a time, as the mix does.
/** @import { TrackPlan } from "./mix-track.js" */
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { encodeFloat32 } from "./encode-float32.js";
import { mixTrack, trackFrames } from "./mix-track.js";
import { newSha256 } from "./sha256-hex.js";
import { stemVoices } from "./stem-voices.js";
import { createWavWriter, FLOAT32 } from "./wav-writer.js";

const CHANNELS = 2;

/**
 * @typedef {object} StemOptions
 * @property {number} gainDb the mix's, from its normalize
 * @property {string} path the WAV to write, which must not exist; removed when the render fails
 *   or is cancelled
 * @property {number} [chunkSeconds] `CHUNK_SECONDS` when omitted; the mix's own
 * @property {AbortSignal} [signal] checked before each chunk
 * @property {(done: number, total: number, step: string) => void} [progress] before each chunk
 */

/**
 * @param {TrackPlan} plan the mix's
 * @param {string} stem a voice id from `stemIds`
 * @param {StemOptions} options
 * @returns {Promise<{ sha256: string, frames: number }>} the hash of the WAV's data chunk
 */
export async function renderStem(plan, stem, { gainDb, path, chunkSeconds, signal, progress }) {
  const frames = trackFrames(plan);
  const gain = 10 ** (gainDb / 20);
  const writer = await createWavWriter(path, {
    channelCount: CHANNELS,
    sampleRate: SAMPLE_RATE,
    frames,
    sampleFormat: FLOAT32,
  });
  const hash = newSha256();
  try {
    const mixing = mixTrack(plan, {
      voices: (genome) => stemVoices(genome, stem),
      ...(chunkSeconds !== undefined && { chunkSeconds }),
      ...(signal && { signal }),
      ...(progress && { progress }),
    });
    for await (const block of mixing) {
      // Scaled in place: each block is a view the mix overwrites with the next.
      for (const channel of block) {
        for (let i = 0; i < channel.length; i++) {
          channel[i] = /** @type {number} */ (channel[i]) * gain;
        }
      }
      const bytes = encodeFloat32(block);
      hash.update(bytes);
      await writer.append(bytes);
    }
    await writer.close();
  } catch (error) {
    await writer.abort();
    throw error;
  }
  return { sha256: hash.digest("hex"), frames };
}

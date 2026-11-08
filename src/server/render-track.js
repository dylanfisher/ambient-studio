// A track's render (decision 0062): the mix streamed from `mixTrack` into a raw float file in a
// temp folder, normalized over that file with 6a's streaming forms, then limited once more into
// a 24-bit WAV whose PCM is hashed as it is written, and an MP3 preview read back from the WAV.
// Nothing holds the whole track: one chunk, one crossfade and one read block at a time.
/** @import { TrackPlan } from "./mix-track.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
import { createReadStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLimiter } from "../domain/limiter.js";
import { normalizeStream } from "../domain/normalize-stream.js";
import { CROSSFADE_LAW } from "../engine/crossfade.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { rendererDifferences, requireFinite, SAME_RENDERERS } from "./export-render.js";
import { JOB_STEP } from "./job-steps.js";
import { mixTrack } from "./mix-track.js";
import { newSha256 } from "./sha256-hex.js";
import { recipePlan, requireManifest } from "./track-manifest.js";
import { createWavWriter, headerBytes, PCM24 } from "./wav-writer.js";
import { writeMp3 } from "./write-mp3.js";

const CHANNELS = 2;
const FLOAT_BYTES = 4;
/** The raw mix's name in the temp folder: interleaved float32 in the machine's byte order. */
const RAW_FILE = "mix.f32";
/** Frames read from the raw file at a time: 1.4 s, 0.5 MB. */
const READ_FRAMES = 2 ** 16;

/**
 * @typedef {object} TrackLoudness
 * @property {number} target LUFS
 * @property {number} ceiling dBTP
 */

/**
 * @typedef {TrackLoudness & { integrated: number, truePeak: number, gainDb: number }} MeasuredLoudness
 */

/**
 * @typedef {object} TrackRenderOptions
 * @property {TrackLoudness} loudness
 * @property {string} tempDir an existing folder for the raw mix, which is removed from it
 *   however the render ends
 * @property {string} [wav] the WAV to write, which must not exist; none when omitted, and the
 *   PCM is only hashed
 * @property {string} [mp3] the preview to write from the WAV; needs `wav`
 * @property {number} [chunkSeconds] `CHUNK_SECONDS` when omitted; tests pass seconds
 * @property {AbortSignal} [signal] checked before each chunk and each read block
 * @property {(done: number, total: number, step: string | null) => void} [progress]
 */

/**
 * @typedef {object} RenderedTrack
 * @property {string} pcmSha256 of the interleaved 24-bit PCM, the WAV's data chunk
 * @property {number} frames
 * @property {MeasuredLoudness} loudness
 */

/**
 * @param {TrackPlan} plan
 * @param {TrackRenderOptions} options
 * @returns {Promise<RenderedTrack>}
 */
export async function renderTrack(plan, options) {
  const { loudness, tempDir, wav, mp3, chunkSeconds, signal, progress } = options;
  if (mp3 !== undefined && wav === undefined) throw new Error("a track's MP3 is made from its WAV");
  const raw = join(tempDir, RAW_FILE);
  try {
    const frames = await writeRaw(raw, plan, {
      ...(chunkSeconds !== undefined && { chunkSeconds }),
      ...(signal && { signal }),
      ...(progress && { progress }),
    });
    progress?.(1, 1, JOB_STEP.normalizingTrack);
    const source = () => readRaw(raw, frames, signal);
    const {
      gainDb,
      threshold,
      loudness: integrated,
      truePeak,
    } = await normalizeStream(source, SAMPLE_RATE, loudness);
    progress?.(1, 1, JOB_STEP.encodingTrack);
    const writer =
      wav === undefined
        ? undefined
        : await createWavWriter(wav, {
            channelCount: CHANNELS,
            sampleRate: SAMPLE_RATE,
            frames,
            sampleFormat: PCM24,
          });
    const hash = newSha256();
    try {
      const limiter = createLimiter(10 ** (gainDb / 20), threshold, SAMPLE_RATE);
      /** @param {Float32Array[]} block */
      const write = async (block) => {
        if ((block[0]?.length ?? 0) === 0) return;
        const bytes = encodePcm24(block);
        hash.update(bytes);
        await writer?.append(bytes);
      };
      for await (const block of source()) await write(limiter.push(block));
      await write(limiter.finish());
      await writer?.close();
    } catch (error) {
      await writer?.abort();
      throw error;
    }
    if (wav !== undefined && mp3 !== undefined) {
      const pcm = createReadStream(wav, { start: headerBytes(PCM24) });
      await writeMp3(mp3, pcm, {
        channelCount: CHANNELS,
        sampleRate: SAMPLE_RATE,
        ...(signal && { signal }),
      });
    }
    return {
      pcmSha256: hash.digest("hex"),
      frames,
      loudness: { ...loudness, integrated, truePeak, gainDb },
    };
  } finally {
    await rm(raw, { force: true });
  }
}

/**
 * Streams the mix into `path` as interleaved float32, refusing a sample that isn't finite.
 * @param {string} path
 * @param {TrackPlan} plan
 * @param {Pick<TrackRenderOptions, "chunkSeconds" | "signal" | "progress">} options
 * @returns {Promise<number>} the frames written
 */
async function writeRaw(path, plan, { chunkSeconds, signal, progress }) {
  const file = await open(path, "wx");
  let frames = 0;
  // One buffer for every block, grown to the largest: each write finishes before the next block.
  let interleaved = new Float32Array(0);
  try {
    const mixing = mixTrack(plan, {
      ...(chunkSeconds !== undefined && { chunkSeconds }),
      ...(signal && { signal }),
      ...(progress && { progress }),
    });
    for await (const block of mixing) {
      requireFinite(block);
      const count = block[0]?.length ?? 0;
      if (interleaved.length < count * CHANNELS) interleaved = new Float32Array(count * CHANNELS);
      for (const [c, channel] of block.entries()) {
        for (let i = 0; i < count; i++) {
          interleaved[i * CHANNELS + c] = /** @type {number} */ (channel[i]);
        }
      }
      await file.write(new Uint8Array(interleaved.buffer, 0, count * CHANNELS * FLOAT_BYTES));
      frames += count;
    }
  } finally {
    await file.close();
  }
  return frames;
}

/**
 * The raw mix from its first frame, a block of every channel at a time.
 * @param {string} path
 * @param {number} frames
 * @param {AbortSignal | undefined} signal
 * @returns {AsyncGenerator<Float32Array[]>}
 */
async function* readRaw(path, frames, signal) {
  const file = await open(path, "r");
  try {
    const buffer = new Float32Array(READ_FRAMES * CHANNELS);
    const bytes = new Uint8Array(buffer.buffer);
    for (let at = 0; at < frames; at += READ_FRAMES) {
      signal?.throwIfAborted();
      const count = Math.min(READ_FRAMES, frames - at);
      const length = count * CHANNELS * FLOAT_BYTES;
      const { bytesRead } = await file.read(bytes, 0, length, at * CHANNELS * FLOAT_BYTES);
      if (bytesRead !== length) {
        throw new Error(`${path} ended at frame ${at}, short of the ${frames} written`);
      }
      yield Array.from({ length: CHANNELS }, (_, c) => {
        const channel = new Float32Array(count);
        for (let i = 0; i < count; i++)
          channel[i] = /** @type {number} */ (buffer[i * CHANNELS + c]);
        return channel;
      });
    }
  } finally {
    await file.close();
  }
}

/**
 * Renders a track again from its manifest alone and checks the PCM hash, writing nothing but its
 * raw temp file, which it removes. Throws, naming why, on a manifest from another engine version
 * or crossfade law, one a genome hash doesn't match, or a render that comes out different.
 * @param {unknown} value the manifest, parsed
 * @param {{ tempDir: string, recordings?: readonly RecordingEntry[] }} options `recordings` is
 *   the recordings folder's index, which a track that plays a field recording needs
 * @returns {Promise<{ pcmSha256: string }>}
 */
export async function rerenderTrack(value, { tempDir, recordings }) {
  const manifest = requireManifest(value, "the manifest");
  if (manifest.engineVersion !== ENGINE_VERSION) {
    const others = rendererDifferences(manifest, "the manifest").map((line) => `; ${line}`);
    throw new Error(
      `the manifest was rendered by engine version ${manifest.engineVersion}, and this is engine version ${ENGINE_VERSION}${others.join("")}. Re-render it from a worktree at tag engine-v${manifest.engineVersion}.`,
    );
  }
  if (manifest.crossfadeLaw !== CROSSFADE_LAW) {
    throw new Error(
      `the manifest's crossfade is ${manifest.crossfadeLaw}; this engine has only ${CROSSFADE_LAW}`,
    );
  }
  const { plan } = await recipePlan(manifest, recordings, manifest.recordings);
  const { target, ceiling } = manifest.loudness;
  const { pcmSha256 } = await renderTrack(plan, {
    loudness: { target, ceiling },
    tempDir,
    chunkSeconds: manifest.chunkSeconds,
  });
  if (pcmSha256 !== manifest.pcmSha256) {
    const differences = rendererDifferences(manifest, "the manifest");
    const why =
      differences.length > 0
        ? `${differences.join("; ")}. Going back to the manifest's versions may reproduce it.`
        : SAME_RENDERERS;
    throw new Error(
      `re-rendering the track doesn't reproduce it: the PCM hashes to ${pcmSha256}, the manifest says ${manifest.pcmSha256}. ${why}`,
    );
  }
  return { pcmSha256 };
}

// The owner-started Analyze job (decision 0051): measures a reference region on excerpt-long
// windows, each normalized to a loudness target, and embeds the windows through the sidecar as
// the region's unit-mean embedding. The features are stored before the sidecar is asked, so a
// sidecar failure fails the job and keeps them. Nothing else starts it.
/** @import { JobContext } from "./job-runner.js" */
/** @import { RegionAnalysis, WindowAnalysis } from "./region-analysis-store.js" */
/** @import { App } from "./routing.js" */
/** @import { Region } from "./reference-store.js" */
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { extractFeatures } from "../domain/extract-features.js";
import { normalize } from "../domain/normalize.js";
import { regionWindows } from "../domain/region-windows.js";
import { unitMean } from "../domain/unit-mean.js";
import { decodeWithFfmpeg } from "./decode-with-ffmpeg.js";
import { embedAudioFile, readEmbedder } from "./embed-audio.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { JOB_STEP } from "./job-steps.js";
import { PRODUCER } from "./producer.js";
import { getReferenceFile, getRegion } from "./reference-store.js";
import {
  findRegionAnalysis,
  putRegionEmbedding,
  putRegionFeatures,
} from "./region-analysis-store.js";
import { writeWav } from "./write-wav.js";

/**
 * @typedef {object} AnalyzeRegionResult
 * @property {number} regionId
 * @property {number} target LUFS
 * @property {number} windows how many windows the region was measured on
 * @property {boolean} embedded whether the region has an embedding under the sidecar's producer
 * @property {string | null} notEmbedded why it has none, as the candidates job says it
 */

/**
 * The live region, or a throw naming why it can't be analyzed.
 * @param {App} app
 * @param {number} regionId
 * @returns {Region}
 */
function liveRegion(app, regionId) {
  const region = getRegion(app.store, regionId);
  if (!region) throw new Error(`there is no region ${regionId}`);
  if (region.removedAt !== null) {
    throw new Error(`region ${regionId} was removed (${region.removedReason})`);
  }
  return region;
}

/** The prefix of the job's temp folders in the reference cache. */
const TEMP_PREFIX = ".analyze-";

/**
 * Removes temp folders a killed server left in the reference cache. Only one Analyze job runs
 * at a time, so none of them is in use.
 * @param {string} folder the reference cache
 */
async function sweepTempFolders(folder) {
  for (const name of await readdir(folder)) {
    if (name.startsWith(TEMP_PREFIX)) await rm(join(folder, name), { recursive: true });
  }
}

/**
 * Decodes the region and writes each window, normalized to `target`, as the owner would hear
 * it, or the decode where normalize couldn't take it, as a 48 kHz WAV in `folder`, one window
 * at a time so a 5-minute region's windows never sit in memory together. With `measure`, it
 * also reads each window's features; without, `windows` is empty, for an embedding made again
 * from features already stored.
 * @param {App} app
 * @param {Region} region
 * @param {number} target
 * @param {string} folder
 * @param {JobContext} job
 * @param {boolean} measure
 * @returns {Promise<{ windows: WindowAnalysis[], files: string[] }>}
 */
async function measureWindows(app, region, target, folder, { signal, progress }, measure) {
  const reference = getReferenceFile(app.store, region.referenceFileId);
  if (!reference) throw new Error(`region ${region.id} names no reference file`);
  progress(0, 0, JOB_STEP.decodingRegion);
  const decoded = await decodeWithFfmpeg(
    join(app.paths.references, reference.file),
    region.startSeconds,
    region.endSeconds,
    signal,
  );
  const { sampleRate } = decoded;
  const frames = /** @type {Float32Array} */ (decoded.channels[0]).length;
  const spans = regionWindows(frames, sampleRate);
  /** @type {WindowAnalysis[]} */
  const windows = [];
  /** @type {string[]} */
  const files = [];
  for (const [index, { start, length }] of spans.entries()) {
    signal.throwIfAborted();
    const step = measure ? JOB_STEP.measuringWindow : JOB_STEP.preparingWindow;
    progress(index, spans.length, step(index + 1, spans.length));
    const channels = decoded.channels.map((channel) => channel.subarray(start, start + length));
    /** @type {ReturnType<typeof normalize> | null} */
    let heard = null;
    /** @type {string | null} */
    let notHeard = null;
    try {
      heard = normalize(channels, sampleRate, { target });
    } catch (error) {
      // A window too quiet to lift is a fact of the recording, as a near-silent render is
      // (0023): its heard features are null, and the reason is kept beside them.
      notHeard = /** @type {Error} */ (error).message;
    }
    if (measure) {
      windows.push({
        startSeconds: start / sampleRate,
        seconds: length / sampleRate,
        features: extractFeatures({ channels, sampleRate }, heard),
        notHeard,
      });
    }
    const file = join(folder, `window-${index + 1}.wav`);
    const audio = (heard ?? { channels }).channels;
    await writeWav(file, encodePcm24(audio), { channelCount: audio.length, sampleRate });
    files.push(file);
  }
  return { windows, files };
}

/**
 * @param {RegionAnalysis} analysis
 * @param {string | null} notEmbedded
 * @returns {AnalyzeRegionResult}
 */
const result = ({ regionId, target, windows, embedding }, notEmbedded) => ({
  regionId,
  target,
  windows: windows.length,
  embedded: embedding !== null,
  notEmbedded,
});

/**
 * The job. A region analyzed under this server's features producer at `target` isn't measured
 * again, and one whose embedding is under the sidecar's producer isn't embedded again. With no
 * checkpoint to embed with, the features are kept and the result says why there is no
 * embedding. A sidecar failure fails the job, naming the region, after the features are stored.
 * @param {App} app
 * @param {{ regionId: number, target: number }} request `target` in LUFS
 * @returns {(job: JobContext) => Promise<AnalyzeRegionResult>}
 */
export function analyzeRegionJob(app, { regionId, target }) {
  return async (job) => {
    const region = liveRegion(app, regionId);
    const key = { regionId, target, producer: PRODUCER };
    await mkdir(app.paths.referenceCache, { recursive: true });
    await sweepTempFolders(app.paths.referenceCache);
    const folder = await mkdtemp(join(app.paths.referenceCache, TEMP_PREFIX));
    try {
      /** @type {string[] | null} */
      let files = null;
      let analysis = findRegionAnalysis(app.store, key);
      if (!analysis) {
        const measured = await measureWindows(app, region, target, folder, job, true);
        files = measured.files;
        analysis = putRegionFeatures(app.store, { ...key, windows: measured.windows });
      }
      const embedder = await readEmbedder(app, { fetch: false, signal: job.signal });
      if (typeof embedder === "string") return result(analysis, embedder);
      if (analysis.embeddingProducer === embedder.producer) return result(analysis, null);

      files ??= (await measureWindows(app, region, target, folder, job, false)).files;
      /** @type {Float32Array[]} */
      const vectors = [];
      for (const [index, file] of files.entries()) {
        job.signal.throwIfAborted();
        job.progress(index, files.length, JOB_STEP.embeddingWindow(index + 1, files.length));
        try {
          vectors.push(await embedAudioFile(app, embedder, file, job.signal));
        } catch (error) {
          if (job.signal.aborted) throw error;
          throw new Error(
            `analyzing the sound of region ${regionId} (“${region.label}”) failed: ${/** @type {Error} */ (error).message}. Its features are kept; analyze it again to retry.`,
            { cause: error },
          );
        }
      }
      job.progress(files.length, files.length, null);
      const mean = unitMean(vectors);
      const embedding = new Uint8Array(mean.buffer, mean.byteOffset, mean.byteLength);
      analysis = putRegionEmbedding(app.store, analysis.id, {
        embeddingProducer: embedder.producer,
        embedding,
      });
      return result(analysis, null);
    } finally {
      await rm(folder, { recursive: true });
    }
  };
}

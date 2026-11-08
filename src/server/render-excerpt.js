// Excerpt renders (decision 0026): the window a candidate is rated on, at its seed and excerpt
// offset (0007), normalized to the vibe's loudness target so an A/B choice isn't won by the
// louder side, measured raw and heard (0023), and cached as an MP3 for playback (0048) with a
// renders row (0021). The cache keeps no lossless copy: rating an excerpt renders it again for
// the FLAC it keeps (`renderHeardAgain`).
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { Normalized } from "../domain/normalize.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { RenderResult } from "../engine/render-plan.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { Render } from "./render-store.js" */
/** @import { Store } from "./store.js" */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { EXCERPT_SECONDS } from "../domain/excerpt-seconds.js";
import { extractFeatures } from "../domain/extract-features.js";
import { lintResult } from "../domain/lint-result.js";
import { normalize } from "../domain/normalize.js";
import { NEAR_SILENCE, renderChecks } from "../domain/render-checks.js";
import { excerptOffset } from "../engine/excerpt-offset.js";
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";
import { requireGenome } from "../engine/validate-genome.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { requireFinite } from "./export-render.js";
import { getGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { loadSamples } from "./load-samples.js";
import { PRODUCER } from "./producer.js";
import { renderOffline } from "./render-offline.js";
import { findRender, putRender } from "./render-store.js";
import { sha256Hex } from "./sha256-hex.js";
import { MP3_EXTENSION, writeMp3 } from "./write-mp3.js";

/** Hex characters of the producer's hash in a cached file's name. */
const PRODUCER_NAME_CHARS = 12;

/**
 * @typedef {object} ExcerptRequest
 * @property {number} genomeId
 * @property {number} seed the candidate's
 * @property {number} target LUFS, from `vibeLoudness`
 */

/** @typedef {{ render: Render, cached: boolean }} Excerpt */

/**
 * The loudness every excerpt of a vibe is normalized to: its fixed `loudness` constraint, or
 * the genome schema's default when it sets none (0018).
 * @param {Constraints} constraints a validated set
 * @returns {number} LUFS
 */
export function vibeLoudness(constraints) {
  return constraints.loudness ?? GLOBAL_PARAMS.loudness.default;
}

/**
 * The cached file's name. Each part of the key that can differ is in it, so a render of another
 * window, or under a new target or producer, never overwrites a file a row still names.
 * @param {ExcerptRequest & { offset: number, duration: number }} request
 */
function cacheFile({ genomeId, seed, target, offset, duration }) {
  const producer = sha256Hex(PRODUCER).slice(0, PRODUCER_NAME_CHARS);
  return `${genomeId}-seed${seed}-at${offset}s-${duration}s-${target}LUFS-${producer}${MP3_EXTENSION}`;
}

/**
 * Whether the render's file is in the cache as a playback MP3. A row whose file is missing, or
 * is a WAV cached before excerpts were MP3s, is rendered again (0048).
 * @param {string} folder the render-cache folder
 * @param {Render} render
 */
export function cachedFile(folder, { file }) {
  return file.endsWith(MP3_EXTENSION) && existsSync(join(folder, file));
}

/** The rule of the finding a render gets when normalize throws on it and near-silence passed. */
export const NORMALIZE_FAILED = "normalize";

/**
 * The audio the owner hears, or null when normalize throws on the render, with the checks that
 * say why. On silence and past its gain cap the near-silence check has already failed (0023);
 * any other throw, such as a limiter that can't reach the target, adds a finding with
 * normalize's message. Either way it is one candidate's problem, not the job's.
 * @param {RenderResult} raw
 * @param {Genome} genome
 * @param {number} target
 * @param {LintResult} checks
 * @returns {{ heard: Normalized | null, checks: LintResult }}
 */
function heardAudio(raw, genome, target, checks) {
  try {
    const heard = normalize(raw.channels, raw.sampleRate, { target, ceiling: genome.ceiling });
    return { heard, checks };
  } catch (error) {
    if (checks.findings.some(({ rule }) => rule === NEAR_SILENCE)) return { heard: null, checks };
    const message = error instanceof Error ? error.message : String(error);
    const finding = { path: "$", rule: NORMALIZE_FAILED, message };
    return { heard: null, checks: lintResult([...checks.findings, finding]) };
  }
}

/**
 * Renders the window and normalizes it as the owner hears it, with the render checks.
 * @param {Genome} genome
 * @param {{ seed: number, offset: number, duration: number, target: number }} window
 * @param {readonly RecordingEntry[] | undefined} recordings
 */
async function renderHeard(genome, { seed, offset, duration, target }, recordings) {
  const { samples } = await loadSamples(genome, recordings);
  const raw = await renderOffline(genome, { seed, duration, offset, samples });
  requireFinite(raw.channels);
  return { raw, ...heardAudio(raw, genome, target, renderChecks(raw, genome)) };
}

/**
 * Writes the MP3 into a temp folder inside `folder` and renames it into place, so a reader never
 * sees half a file. A file already of that name is replaced: it was made for the same window,
 * target and producer, and is left only when a render's row was lost.
 * @param {string} folder
 * @param {string} file
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 */
async function writeCached(folder, file, channels, sampleRate) {
  await mkdir(folder, { recursive: true });
  const temp = await mkdtemp(join(folder, ".excerpt-"));
  try {
    const staged = join(temp, file);
    await writeMp3(staged, encodePcm24(channels), { channelCount: channels.length, sampleRate });
    await rename(staged, join(folder, file));
  } finally {
    await rm(temp, { recursive: true });
  }
}

/**
 * The excerpt of `genomeId` at `seed`, `EXCERPT_SECONDS` long, from the cache when a row for it
 * was made under this target and producer and its file is there, else rendered and cached. A
 * render normalize throws on is cached as rendered, with no gain, and a failed check says why;
 * the call itself throws only on a fault outside normalize. With `window`, it is that window
 * instead, as a track section's player plays it (decision 0061).
 * @param {Store} store
 * @param {string} folder the render-cache folder
 * @param {ExcerptRequest} request
 * @param {readonly RecordingEntry[]} [recordings] the recordings folder's index, which a genome
 *   that plays a field recording needs; its files are decoded only when the excerpt isn't cached
 * @param {{ offset: number, duration: number }} [window] seconds on the genome's timeline, inside
 *   its duration; the excerpt's window when omitted
 * @returns {Promise<Excerpt>}
 */
export async function renderExcerpt(store, folder, { genomeId, seed, target }, recordings, window) {
  const row = getGenome(store, genomeId);
  if (!row) throw new Error(`there is no genome ${genomeId} to render`);
  const genome = requireGenome(row.genome, `genome ${genomeId}`);
  const duration = window?.duration ?? EXCERPT_SECONDS;
  const offset = window?.offset ?? excerptOffset(genome, seed, duration);
  const key = { genomeId, seed, offset, duration, target, producer: PRODUCER };
  const found = findRender(store, key);
  if (found && cachedFile(folder, found)) return { render: found, cached: true };

  const { raw, heard, checks } = await renderHeard(genome, key, recordings);
  const features = extractFeatures(raw, heard);
  const file = cacheFile({ genomeId, seed, target, offset, duration });
  await writeCached(folder, file, (heard ?? raw).channels, raw.sampleRate);
  const { render, replaced } = putRender(store, { ...key, file, features, checks });
  // force: a replaced row's file may already be gone, which is the state this asks for.
  if (replaced && replaced.file !== file) await rm(join(folder, replaced.file), { force: true });
  return { render, cached: false };
}

/**
 * The audio a render's MP3 was encoded from, rendered again: the exact normalized samples, which
 * a rated excerpt's FLAC keeps (0026). Renders are reproducible under one producer (0009), and
 * a genome's recordings are found by their hash (0029), so this is what was heard. Throws if the
 * gain or the checks come out other than the row recorded, which would mean they are not.
 * @param {Store} store
 * @param {Render} render made under this server's producer
 * @param {readonly RecordingEntry[]} [recordings] as `renderExcerpt` takes it
 * @returns {Promise<{ channels: Float32Array[], sampleRate: number, gainDb: number }>} `gainDb`
 *   is 0 for a render normalize couldn't lift, which was cached as rendered
 */
export async function renderHeardAgain(store, render, recordings) {
  const row = getGenome(store, render.genomeId);
  if (!row) throw new Error(`there is no genome ${render.genomeId} to render`);
  const genome = requireGenome(row.genome, `genome ${render.genomeId}`);
  const { raw, heard, checks } = await renderHeard(genome, render, recordings);
  const recorded = /** @type {Features} */ (render.features).heard?.gainDb ?? null;
  const gainDb = heard?.gainDb ?? null;
  if (gainDb !== recorded || !isDeepStrictEqual(checks, render.checks)) {
    throw new Error(
      `render ${render.id} came out different when rendered again (gain ${gainDb} dB, its row says ${recorded} dB), so it can't be kept as what was heard; render the excerpt again`,
    );
  }
  return { channels: (heard ?? raw).channels, sampleRate: raw.sampleRate, gainDb: gainDb ?? 0 };
}

/**
 * Renders each excerpt in turn as a job, checking for a cancel before each one.
 * @param {Store} store
 * @param {string} folder the render-cache folder
 * @param {ExcerptRequest[]} requests
 * @param {JobContext} job
 * @param {readonly RecordingEntry[]} [recordings] as `renderExcerpt` takes it
 * @returns {Promise<Excerpt[]>} in the order asked
 */
export async function renderExcerpts(store, folder, requests, { signal, progress }, recordings) {
  /** @type {Excerpt[]} */
  const done = [];
  const total = requests.length;
  for (const request of requests) {
    progress(done.length, total, JOB_STEP.renderingExcerpt(done.length + 1, total));
    signal.throwIfAborted();
    done.push(await renderExcerpt(store, folder, request, recordings));
  }
  progress(total, total, null);
  return done;
}

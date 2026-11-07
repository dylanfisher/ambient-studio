// Excerpt renders (decision 0026): the window a candidate is rated on, at its seed and excerpt
// offset (0007), normalized to the vibe's loudness target so an A/B choice isn't won by the
// louder side, measured raw and heard (0023), and cached as a WAV with a renders row (0021).
/** @import { Constraints } from "../domain/constraint-schema.js" */
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
import { loadSamples } from "./load-samples.js";
import { PRODUCER } from "./producer.js";
import { renderOffline } from "./render-offline.js";
import { findRender, putRender } from "./render-store.js";
import { sha256Hex } from "./sha256-hex.js";
import { writeWav } from "./write-wav.js";

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
 * The cached file's name. Each part of the key that can differ for one window is in it, so a
 * render under a new target or producer never overwrites a file a row still names.
 * @param {ExcerptRequest & { duration: number }} request
 */
function cacheFile({ genomeId, seed, target, duration }) {
  const producer = sha256Hex(PRODUCER).slice(0, PRODUCER_NAME_CHARS);
  return `${genomeId}-seed${seed}-${duration}s-${target}LUFS-${producer}.wav`;
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
 * Writes the WAV into a temp folder inside `folder` and renames it into place, so a reader never
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
    await writeWav(staged, encodePcm24(channels), { channelCount: channels.length, sampleRate });
    await rename(staged, join(folder, file));
  } finally {
    await rm(temp, { recursive: true });
  }
}

/**
 * The excerpt of `genomeId` at `seed`, `EXCERPT_SECONDS` long, from the cache when a row for it
 * was made under this target and producer and its file is there, else rendered and cached. A
 * render normalize throws on is cached as rendered, with no gain, and a failed check says why;
 * the call itself throws only on a fault outside normalize.
 * @param {Store} store
 * @param {string} folder the render-cache folder
 * @param {ExcerptRequest} request
 * @param {readonly RecordingEntry[]} [recordings] the recordings folder's index, which a genome
 *   that plays a field recording needs; its files are decoded only when the excerpt isn't cached
 * @returns {Promise<Excerpt>}
 */
export async function renderExcerpt(store, folder, { genomeId, seed, target }, recordings) {
  const row = getGenome(store, genomeId);
  if (!row) throw new Error(`there is no genome ${genomeId} to render`);
  const genome = requireGenome(row.genome, `genome ${genomeId}`);
  const duration = EXCERPT_SECONDS;
  const offset = excerptOffset(genome, seed, duration);
  const key = { genomeId, seed, offset, duration, target, producer: PRODUCER };
  const found = findRender(store, key);
  if (found && existsSync(join(folder, found.file))) return { render: found, cached: true };

  const { samples } = await loadSamples(genome, recordings);
  const raw = await renderOffline(genome, { seed, duration, offset, samples });
  requireFinite(raw.channels);
  const { heard, checks } = heardAudio(raw, genome, target, renderChecks(raw, genome));
  const features = extractFeatures(raw, heard);
  const file = cacheFile({ genomeId, seed, target, duration });
  await writeCached(folder, file, (heard ?? raw).channels, raw.sampleRate);
  const { render, replaced } = putRender(store, { ...key, file, features, checks });
  // force: a replaced row's file may already be gone, which is the state this asks for.
  if (replaced && replaced.file !== file) await rm(join(folder, replaced.file), { force: true });
  return { render, cached: false };
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
  progress(0, requests.length);
  for (const request of requests) {
    signal.throwIfAborted();
    done.push(await renderExcerpt(store, folder, request, recordings));
    progress(done.length, requests.length);
  }
  return done;
}

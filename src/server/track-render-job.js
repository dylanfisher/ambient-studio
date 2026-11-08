// The owner-started jobs of a track (decision 0062): rendering a revision with its MP3 preview,
// rendering 30 s around one transition, and exporting a rendered revision. Renders are derived
// and cached in the data root's track-renders/, a folder per track and one per recipe hash; a
// render in progress writes only into a `.render-` temp folder there, removed however it ends.
// Exports go to a new folder under exports/ and are logged in `track_exports`.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
/** @import { Store } from "./store.js" */
/** @import { TrackManifest, TrackRecipe } from "./track-manifest.js" */
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { normalize } from "../domain/normalize.js";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { jobRecordings } from "./candidate-job.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { requireFinite } from "./export-render.js";
import { JOB_STEP } from "./job-steps.js";
import { mixTrack, trackLayout } from "./mix-track.js";
import { renderTrack } from "./render-track.js";
import { sha256Hex } from "./sha256-hex.js";
import { recipeKey, recipePlan, trackRecipe } from "./track-manifest.js";
import { addTrackExport, getTrack, listTrackRevisions } from "./track-store.js";
import { getVibe } from "./vibe-store.js";
import { writeFlac } from "./write-flac.js";
import { writeMp3 } from "./write-mp3.js";

/** The files of a cached render, in its hash's folder. The manifest is moved in last. */
export const RENDER_FILE = Object.freeze({
  wav: "mix.wav",
  mp3: "mix.mp3",
  manifest: "manifest.json",
});

/** Seconds of track a seam preview plays, centered on its transition. */
const SEAM_SECONDS = 30;

/** Characters of the track's name kept in an export's folder name. */
const NAME_CHARS = 40;

/**
 * A seam preview's file name.
 * @param {number} transition counted from 0
 */
export const seamFile = (transition) => `seam-${transition + 1}.mp3`;

/** The prefix of a render's temp folder. */
const TEMP_PREFIX = ".render-";

/**
 * The revision, its track and its recipe, read when the job starts.
 * @param {Store} store
 * @param {{ trackId: number, revisionId: number }} ids
 */
export function revisionRecipe(store, { trackId, revisionId }) {
  const track = getTrack(store, trackId);
  if (!track) throw new Error(`there is no track ${trackId}`);
  const revisions = listTrackRevisions(store, trackId);
  const index = revisions.findIndex(({ id }) => id === revisionId);
  const revision = revisions[index];
  if (!revision) throw new Error(`track ${trackId} has no revision ${revisionId}`);
  const vibe = getVibe(store, track.vibeId);
  if (!vibe) throw new Error(`track ${trackId} names no vibe ${track.vibeId}`);
  // A stored revision passed validateConstraints, so the cast holds.
  const constraints = /** @type {Constraints} */ (vibe.revision.constraints);
  const { recipe, cost } = trackRecipe(store, { track, revision, constraints });
  return { track, revision, version: index + 1, recipe, cost, key: recipeKey(recipe) };
}

/**
 * The folder a track's renders are cached in, and the one for a recipe's hash.
 * @param {App} app
 * @param {number} trackId
 * @param {string} key
 */
const folders = (app, trackId, key) => {
  const track = join(app.paths.trackRenders, String(trackId));
  return { track, render: join(track, key) };
};

/**
 * The URL a cached MP3 is played from.
 * @param {number} trackId
 * @param {string} key
 * @param {string} file
 */
export const trackAudioUrl = (trackId, key, file) => `/api/tracks/${trackId}/audio/${key}/${file}`;

/**
 * The cached render's manifest, or null when the revision's recipe hasn't been rendered or a
 * file of it is gone.
 * @param {App} app
 * @param {number} trackId
 * @param {string} key
 * @returns {Promise<TrackManifest | null>}
 */
export async function cachedRender(app, trackId, key) {
  const { render } = folders(app, trackId, key);
  if (!Object.values(RENDER_FILE).every((file) => existsSync(join(render, file)))) return null;
  return JSON.parse(await readFile(join(render, RENDER_FILE.manifest), "utf8"));
}

/**
 * Removes every entry of a track's cache folder but `keep`: renders and seam previews of other
 * revisions, which are derived, and temp folders a crash left. One track job runs at a time, so
 * none of them is in use.
 * @param {string} trackDir
 * @param {readonly string[]} keep
 */
async function removeOthers(trackDir, keep) {
  for (const entry of await readdir(trackDir)) {
    if (!keep.includes(entry)) await rm(join(trackDir, entry), { recursive: true, force: true });
  }
}

/**
 * The job that renders a revision, normalizes it and writes its WAV, MP3 preview and manifest
 * to the cache, then removes the track's other cached renders, which are derived and about 0.4 GB
 * each at 20 minutes. A cached render is returned as it is.
 * @param {App} app
 * @param {{ trackId: number, revisionId: number }} ids
 */
export function trackRenderJob(app, ids) {
  return async (/** @type {JobContext} */ job) => {
    const { trackId } = ids;
    const { recipe, cost, key } = revisionRecipe(app.store, ids);
    const url = trackAudioUrl(trackId, key, RENDER_FILE.mp3);
    if (await cachedRender(app, trackId, key)) return { cached: true, key, url };
    const { track: trackDir, render } = folders(app, trackId, key);
    await mkdir(trackDir, { recursive: true });
    const temp = await mkdtemp(join(trackDir, TEMP_PREFIX));
    try {
      const { plan, files } = await recipePlan(recipe, await jobRecordings(app));
      const started = performance.now();
      const done = await renderTrack(plan, {
        loudness: recipe.loudness,
        tempDir: temp,
        wav: join(temp, RENDER_FILE.wav),
        mp3: join(temp, RENDER_FILE.mp3),
        signal: job.signal,
        progress: job.progress,
      });
      const seconds = (performance.now() - started) / 1000;
      /** @type {TrackManifest} */
      const manifest = {
        ...recipe,
        loudness: done.loudness,
        frames: done.frames,
        pcmSha256: done.pcmSha256,
        ...(Object.keys(files).length > 0 && { recordings: files }),
      };
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(temp, RENDER_FILE.manifest), text, { flag: "wx" });
      await mkdir(render, { recursive: true });
      for (const file of Object.values(RENDER_FILE))
        await rename(join(temp, file), join(render, file));
      await removeOthers(trackDir, [key, basename(temp)]);
      job.progress(1, 1, null);
      return { cached: false, key, url, seconds, rate: cost.work / seconds };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  };
}

/**
 * The span of a seam preview in track frames: `SEAM_SECONDS` centered on the transition's
 * middle, inside the track.
 * @param {TrackRecipe} recipe
 * @param {number} transition counted from 0
 */
export function seamSpan(recipe, transition) {
  const plan = {
    sections: recipe.sections,
    transitions: recipe.transitions.map(({ seconds }) => seconds),
  };
  const { starts, frames } = trackLayout(plan);
  const next = starts[transition + 1];
  const fade = recipe.transitions[transition];
  if (next === undefined || !fade) {
    throw new Error(`the track has no transition ${transition + 1}`);
  }
  const middle = next + Math.round((fade.seconds * SAMPLE_RATE) / 2);
  const half = (SEAM_SECONDS * SAMPLE_RATE) / 2;
  const from = Math.max(0, Math.min(middle - half, frames - 2 * half));
  return { from, to: Math.min(frames, from + 2 * half) };
}

/**
 * The job that renders the span around one transition, normalized on its own to the track's
 * loudness target, as an MP3 in the revision's cache folder. Its samples before normalizing are
 * that span of the full render, since it renders the same chunks.
 * @param {App} app
 * @param {{ trackId: number, revisionId: number, transition: number }} request
 */
export function seamPreviewJob(app, { trackId, revisionId, transition }) {
  return async (/** @type {JobContext} */ job) => {
    const { recipe, key } = revisionRecipe(app.store, { trackId, revisionId });
    const { from, to } = seamSpan(recipe, transition);
    const file = seamFile(transition);
    const span = { from: from / SAMPLE_RATE, to: to / SAMPLE_RATE };
    const url = trackAudioUrl(trackId, key, file);
    const { track: trackDir, render } = folders(app, trackId, key);
    if (existsSync(join(render, file))) return { cached: true, url, ...span };
    const { plan } = await recipePlan(recipe, await jobRecordings(app));
    const channels = [0, 1].map(() => new Float32Array(to - from));
    let at = 0;
    for await (const block of mixTrack(plan, {
      from,
      to,
      signal: job.signal,
      progress: job.progress,
    })) {
      for (const [c, channel] of block.entries()) channels[c]?.set(channel, at);
      at += block[0]?.length ?? 0;
    }
    requireFinite(channels);
    const heard = normalize(channels, SAMPLE_RATE, recipe.loudness);
    await mkdir(render, { recursive: true });
    const temp = await mkdtemp(join(render, TEMP_PREFIX));
    try {
      await writeMp3(join(temp, file), encodePcm24(heard.channels), {
        channelCount: heard.channels.length,
        sampleRate: SAMPLE_RATE,
        signal: job.signal,
      });
      await rename(join(temp, file), join(render, file));
      // Only the revision being heard keeps a cache folder, rendered or seam-only.
      await removeOthers(trackDir, [key]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    job.progress(1, 1, null);
    return { cached: false, url, ...span };
  };
}

/**
 * An export's folder name: the track's id, the version's number and the track's name lowered to
 * ASCII letters, digits and dashes, so no part of a name can reach outside exports/.
 * @param {{ id: number, name: string }} track
 * @param {number} version counted from 1, as the page lists them
 */
export function exportFolder({ id, name }, version) {
  if (!(Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(version) && version > 0)) {
    throw new Error(
      `an export folder needs a track id and a version number, each whole and above 0, got ${id} and ${version}`,
    );
  }
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_CHARS)
    .replace(/-+$/, "");
  return `track${id}-v${version}${words ? `-${words}` : ""}`;
}

/**
 * The export's folder, which must not exist yet, inside exports/.
 * @param {App} app
 * @param {string} folder from `exportFolder`
 */
export function exportPath(app, folder) {
  const root = resolve(app.paths.exports);
  const path = resolve(root, folder);
  if (dirname(path) !== root)
    throw new Error(`the export folder ${folder} would land outside ${root}`);
  return path;
}

/**
 * The job that exports a rendered revision: a new folder under exports/ holding the cached
 * WAV, linked, a FLAC made from it (0012) and the manifest naming both, then a `track_exports`
 * row. `mkdir` without `recursive` fails on a folder that exists, so an export never writes into
 * one; on a failure the folder it made is removed.
 * @param {App} app
 * @param {{ trackId: number, revisionId: number }} ids
 */
export function trackExportJob(app, ids) {
  return async (/** @type {JobContext} */ job) => {
    const { track, version, key, recipe } = revisionRecipe(app.store, ids);
    const cached = await cachedRender(app, ids.trackId, key);
    if (!cached) throw new Error("the version's render is gone from the cache; render it again");
    const folder = exportFolder(track, version);
    const dir = exportPath(app, folder);
    job.progress(0, 1, JOB_STEP.exportingTrack);
    await mkdir(app.paths.exports, { recursive: true });
    try {
      await mkdir(dir);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      throw new Error(`${folder} already exists in exports; an export never overwrites`, {
        cause: error,
      });
    }
    try {
      const files = { wav: `${folder}.wav`, flac: `${folder}.flac` };
      const { render } = folders(app, ids.trackId, key);
      await link(join(render, RENDER_FILE.wav), join(dir, files.wav));
      await writeFlac(join(dir, files.wav), join(dir, files.flac), job.signal);
      job.signal.throwIfAborted();
      // The cache is shared by revisions that sound the same, so the track and revision named
      // are this export's own; the audio and its hash are the cached render's.
      const text = `${JSON.stringify({ files, ...cached, track: recipe.track }, null, 2)}\n`;
      await writeFile(join(dir, `${folder}.json`), text, { flag: "wx" });
      job.signal.throwIfAborted();
      addTrackExport(app.store, {
        trackRevisionId: ids.revisionId,
        kind: "mix",
        folder,
        manifestSha256: sha256Hex(text),
      });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    job.progress(1, 1, null);
    return { folder, path: dir };
  };
}

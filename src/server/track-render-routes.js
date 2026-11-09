// The routes that render and export a track (decision 0062): a revision's render state and
// estimate, starting its render, a seam preview or an export, with stems or not (0063), and
// playing a cached MP3. Nothing renders except from the three POSTs, each an owner-started job;
// one track job runs at a time.
/** @import { App, Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { JOB_KIND } from "../domain/job-kind.js";
import { BENCH_RATE } from "../domain/track-cost.js";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { fileInside } from "./file-inside.js";
import { fields, idParam, integer, oneOf, rowId } from "./request-fields.js";
import { duplicateJob, HttpError } from "./routing.js";
import { sendMp3 } from "./send-mp3.js";
import { stemIds } from "./stem-voices.js";
import {
  cachedRender,
  exportFolder,
  exportPath,
  RENDER_FILE,
  revisionRecipe,
  seamFile,
  seamPreviewJob,
  seamSpan,
  trackAudioUrl,
  trackExportJob,
  trackRenderJob,
} from "./track-render-job.js";
import { checkedArrangement, requireTrack } from "./track-routes.js";
import { EXPORT_KIND, listTrackExports, listTrackRevisions } from "./track-store.js";

/** The jobs that render or export a track, one of which runs at a time. */
/** @type {readonly string[]} */
const TRACK_JOBS = Object.freeze([
  JOB_KIND.trackRender,
  JOB_KIND.seamPreview,
  JOB_KIND.trackExport,
]);

/** What a cached file's path segments may be: a recipe hash, and a preview's name. */
const KEY = /^[0-9a-f]{64}$/;
const AUDIO_FILE = /^(mix|seam-[1-9]\d{0,2})\.mp3$/;

/**
 * The track and the revision a body or path names, checked: the revision is the track's own,
 * its arrangement still valid against the vibe's live sketches, and it has a section.
 * @param {Store} store
 * @param {Record<string, string>} params
 * @param {number} revisionId
 */
function requireRevision(store, params, revisionId) {
  const { track } = requireTrack(store, params);
  const revision = listTrackRevisions(store, track.id).find(({ id }) => id === revisionId);
  if (!revision) throw new HttpError(404, `track ${track.id} has no version ${revisionId}`);
  checkedArrangement(store, track, revision.arrangement);
  if (revision.arrangement.sections.length === 0) {
    throw new HttpError(400, "This version has no sections to render. Add a sketch first.");
  }
  return { trackId: track.id, revisionId };
}

/**
 * Refuses a second track job while one hasn't finished.
 * @param {App} app
 */
function refuseDuplicate(app) {
  const unfinished = app.jobs
    .list()
    .find((job) => TRACK_JOBS.includes(job.kind) && job.finishedAt === null);
  if (unfinished) {
    throw duplicateJob(
      `A track is already being rendered or exported (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
      unfinished.id,
    );
  }
}

/**
 * The last finished track render's speed in node-seconds a wall second, or the bench's when no
 * track has rendered since the server started.
 * @param {App} app
 */
function lastRate(app) {
  const done = app.jobs
    .list()
    .filter((job) => job.kind === JOB_KIND.trackRender)
    .map((job) => /** @type {{ rate?: number } | null} */ (app.jobs.get(job.id).result))
    .filter((result) => Number.isFinite(result?.rate));
  const rate = done.at(-1)?.rate;
  return rate === undefined ? { rate: BENCH_RATE, measured: false } : { rate, measured: true };
}

/** @type {Route[]} */
export const TRACK_RENDER_ROUTES = [
  {
    method: "GET",
    path: "/api/tracks/:trackId/revisions/:revisionId/render",
    handle: async ({ app, params }) => {
      const ids = requireRevision(app.store, params, idParam(params, "revisionId"));
      const { recipe, cost, key, track, version } = revisionRecipe(app.store, ids);
      const cached = await cachedRender(app, ids.trackId, key);
      const render = join(app.paths.trackRenders, String(ids.trackId), key);
      return {
        estimate: { cost, ...lastRate(app) },
        preview: cached && {
          url: trackAudioUrl(ids.trackId, key, RENDER_FILE.mp3),
          loudness: cached.loudness,
          seconds: cached.frames / cached.sampleRate,
        },
        seams: recipe.transitions
          .map((_, transition) => transition)
          .filter((transition) => existsSync(join(render, seamFile(transition))))
          .map((transition) => ({
            transition,
            url: trackAudioUrl(ids.trackId, key, seamFile(transition)),
            from: seamSpan(recipe, transition).from / SAMPLE_RATE,
          })),
        folder: exportFolder(track, version),
        stems: stemIds(recipe.sections),
        exports: listTrackExports(app.store, ids.revisionId),
      };
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/render",
    handle: async ({ app, params, body }) => {
      const given = fields(await body(), ["revisionId"]);
      const ids = requireRevision(app.store, params, rowId(given, "revisionId"));
      refuseDuplicate(app);
      return app.jobs.add(JOB_KIND.trackRender, trackRenderJob(app, ids));
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/seam-preview",
    handle: async ({ app, params, body }) => {
      const given = fields(await body(), ["revisionId", "transition"]);
      const ids = requireRevision(app.store, params, rowId(given, "revisionId"));
      const { recipe } = revisionRecipe(app.store, ids);
      const last = recipe.transitions.length - 1;
      if (last < 0) throw new HttpError(400, "This version has one section, so no crossfade.");
      const transition = integer(given, "transition", { min: 0, max: last });
      refuseDuplicate(app);
      return app.jobs.add(JOB_KIND.seamPreview, seamPreviewJob(app, { ...ids, transition }));
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/export",
    handle: async ({ app, params, body }) => {
      const given = fields(await body(), ["revisionId", "kind"]);
      const ids = requireRevision(app.store, params, rowId(given, "revisionId"));
      const kind =
        given.kind === undefined
          ? EXPORT_KIND.mix
          : oneOf(given, "kind", Object.values(EXPORT_KIND));
      const { key, track, version } = revisionRecipe(app.store, ids);
      if (!(await cachedRender(app, ids.trackId, key))) {
        throw new HttpError(409, "Render this version first; the export writes its render.");
      }
      const folder = exportFolder(track, version);
      if (existsSync(exportPath(app, folder))) {
        throw new HttpError(409, `${folder} already exists in exports; an export never overwrites`);
      }
      refuseDuplicate(app);
      return app.jobs.add(JOB_KIND.trackExport, trackExportJob(app, ids, kind));
    },
  },
  {
    method: "GET",
    path: "/api/tracks/:trackId/audio/:key/:file",
    handle: async ({ app, params, request, response }) => {
      const { track } = requireTrack(app.store, params);
      const { key = "", file = "" } = params;
      if (!KEY.test(key) || !AUDIO_FILE.test(file)) throw new HttpError(404, "no such preview");
      const found = await fileInside(app.paths.trackRenders, [String(track.id), key, file]);
      if (!found) throw new HttpError(404, "no such preview; render it again");
      await sendMp3(request, response, found);
      return undefined;
    },
  },
];

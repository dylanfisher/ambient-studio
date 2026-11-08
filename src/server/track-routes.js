// The track routes (decision 0061): a vibe's tracks, making one, reading one with its revisions
// and the vibe's sketches to place, saving an arrangement as a new revision, removing a track,
// and rendering one section's window for its player on the timeline. An edit never changes a
// row: it appends a revision (0021). Rendering a whole track is 6c's.
/** @import { ArrangementContext, ArrangementSketch } from "../domain/validate-arrangement.js" */
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { Sketch } from "./rating-store.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
/** @import { TrackRevision } from "./track-store.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { emptyArrangement, SECTION_KEYS } from "../domain/arrangement-schema.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { currentExcerpt, excerptRequest } from "./candidate-excerpt.js";
import { jobRecordings } from "./candidate-job.js";
import { getCandidate, getGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { getSketch, listSketches } from "./rating-store.js";
import { renderExcerpt, vibeLoudness } from "./render-excerpt.js";
import { fields, idParam, MAX_CHARS, text } from "./request-fields.js";
import { duplicateJob, HttpError } from "./routing.js";
import {
  createTrack,
  getTrack,
  listTrackRevisions,
  listTracks,
  removeTrack,
  reviseTrack,
  TRACK_REVISION_FIELD,
} from "./track-store.js";
import { requireVibe } from "./vibe-routes.js";
import { getRevision, getVibe } from "./vibe-store.js";

const SECTION_AUDIO_JOB = JOB_KIND.sectionAudio;

/**
 * The sketch's candidate and genome. Throws when a row it names is missing, which the store's
 * foreign keys rule out.
 * @param {Store} store
 * @param {{ id: number, candidateId: number }} sketch
 */
function sketchParts(store, { id, candidateId }) {
  const candidate = getCandidate(store, candidateId);
  if (!candidate) throw new Error(`sketch ${id} names no candidate ${candidateId}`);
  const revision = getRevision(store, candidate.vibeRevisionId);
  if (!revision) throw new Error(`candidate ${candidateId} names no revision`);
  if (candidate.genomeId === null) throw new Error(`sketch ${id} keeps a candidate with no genome`);
  const genome = getGenome(store, candidate.genomeId)?.genome;
  if (!genome) throw new Error(`candidate ${candidateId} names no genome ${candidate.genomeId}`);
  return { candidate, vibeId: revision.vibeId, duration: /** @type {number} */ (genome.duration) };
}

/**
 * What `validateArrangement` reads of the sketches, for a track of `vibeId`.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {ArrangementContext}
 */
function arrangementContext(store, vibeId) {
  return {
    vibeId,
    sketch: (id) => {
      const sketch = getSketch(store, id);
      if (!sketch) return undefined;
      const { vibeId: of, duration } = sketchParts(store, sketch);
      return /** @type {ArrangementSketch} */ ({
        vibeId: of,
        removedReason: sketch.removedReason,
        duration,
      });
    },
  };
}

/**
 * The arrangement checked against the vibe's sketches, or a 400 listing every error.
 * @param {Store} store
 * @param {number} vibeId
 * @param {unknown} given
 */
function checkedArrangement(store, vibeId, given) {
  const checked = validateArrangement(given, arrangementContext(store, vibeId));
  if (!checked.ok) {
    const list = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new HttpError(400, `the arrangement is invalid: ${list}`);
  }
  return checked.arrangement;
}

/**
 * The track named by the path, or a 404 when there is none, it was removed, or its vibe was.
 * @param {Store} store
 * @param {Record<string, string>} params
 */
function requireTrack(store, params) {
  const id = idParam(params, "trackId");
  const track = getTrack(store, id);
  const vibe = track && getVibe(store, track.vibeId);
  if (!track || track.removedAt !== null || !vibe || vibe.removedAt !== null) {
    throw new HttpError(404, `there is no track ${id}`);
  }
  return { track, vibe };
}

/**
 * A revision as the page reads it, with the length its arrangement plays.
 * @param {TrackRevision} revision
 */
const revisionView = (revision) => ({
  ...revision,
  length: arrangementLength(revision.arrangement),
});

/**
 * The vibe's live sketches as the timeline places them, oldest first, each with its candidate's
 * intent, its genome's duration and its excerpt when one is cached.
 * @param {App} app
 * @param {number} vibeId
 */
function trackMaterial(app, vibeId) {
  return listSketches(app.store, vibeId).map((sketch) => {
    const { candidate, duration } = sketchParts(app.store, sketch);
    const excerpt = currentExcerpt(app.store, app.paths.renderCache, candidate);
    return {
      id: sketch.id,
      candidateId: sketch.candidateId,
      intent: candidate.intent,
      notes: sketch.notes,
      tags: sketch.tags,
      duration,
      excerpt: excerpt && {
        url: `/audio/${excerpt.id}`,
        offset: excerpt.offset,
        duration: excerpt.duration,
      },
    };
  });
}

/**
 * The job that renders one section's window of its sketch at the sketch's seed, normalized to
 * the vibe's loudness target, through the excerpt path, so it is cached like an excerpt. The
 * window stops at the sketch's end: playing the extended part needs 6c's section genome.
 * @param {App} app
 * @param {{ candidateId: number, target: number, offset: number, duration: number }} request
 */
function sectionAudioJob(app, { candidateId, target, offset, duration }) {
  return async (/** @type {JobContext} */ job) => {
    const candidate = getCandidate(app.store, candidateId);
    const request = candidate && excerptRequest(app.store, candidate);
    if (!request) throw new Error(`candidate ${candidateId} has no genome to render`);
    job.progress(0, 1, JOB_STEP.renderingSection(duration));
    job.signal.throwIfAborted();
    const recordings = await jobRecordings(app);
    const { render, cached } = await renderExcerpt(
      app.store,
      app.paths.renderCache,
      { ...request, target },
      recordings,
      { offset, duration },
    );
    job.progress(1, 1, null);
    return { renderId: render.id, url: `/audio/${render.id}`, offset, duration, cached };
  };
}

/** @type {Route[]} */
export const TRACK_ROUTES = [
  {
    method: "GET",
    path: "/api/vibes/:vibeId/tracks",
    handle: ({ app, params }) => ({
      tracks: listTracks(app.store, requireVibe(app.store, params).id).map((track) => ({
        ...track,
        revision: revisionView(track.revision),
      })),
    }),
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/tracks",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), ["name"]);
      const name = text(given, "name", MAX_CHARS.name);
      const { track, revision } = createTrack(app.store, {
        vibeId: vibe.id,
        name,
        arrangement: emptyArrangement(),
      });
      return { track, revision: revisionView(revision) };
    },
  },
  {
    method: "GET",
    path: "/api/tracks/:trackId",
    handle: ({ app, params }) => {
      const { track, vibe } = requireTrack(app.store, params);
      return {
        track,
        vibe: { id: vibe.id, name: vibe.revision.name },
        revisions: listTrackRevisions(app.store, track.id).map(revisionView),
        sketches: trackMaterial(app, vibe.id),
      };
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/revisions",
    handle: async ({ app, params, body }) => {
      const { track } = requireTrack(app.store, params);
      const given = fields(await body(), Object.values(TRACK_REVISION_FIELD));
      const arrangement = checkedArrangement(app.store, track.vibeId, given.arrangement);
      const note = text(given, TRACK_REVISION_FIELD.note, MAX_CHARS.note, { allowEmpty: true });
      return revisionView(reviseTrack(app.store, track.id, { arrangement, note }));
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/remove",
    handle: async ({ app, params, body }) => {
      const { track } = requireTrack(app.store, params);
      fields(await body(), []);
      removeTrack(app.store, track.id);
      return { track: getTrack(app.store, track.id) };
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/section-audio",
    handle: async ({ app, params, body }) => {
      const { track, vibe } = requireTrack(app.store, params);
      // The body is one section, checked as an arrangement of one, so it is held to the same
      // rules as a saved one.
      const section = fields(await body(), SECTION_KEYS);
      const [checked] = checkedArrangement(app.store, track.vibeId, {
        ...emptyArrangement(),
        sections: [section],
      }).sections;
      if (!checked) throw new Error("an arrangement of one section came back with none");
      const sketch = /** @type {Sketch} */ (getSketch(app.store, checked.sketchId));
      const { duration } = sketchParts(app.store, sketch);
      const unfinished = app.jobs
        .list()
        .find((job) => job.kind === SECTION_AUDIO_JOB && job.finishedAt === null);
      if (unfinished) {
        throw duplicateJob(
          `A section is already being rendered to play (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      // A stored revision passed validateConstraints, so the cast holds.
      const target = vibeLoudness(/** @type {Constraints} */ (vibe.revision.constraints));
      return app.jobs.add(
        SECTION_AUDIO_JOB,
        sectionAudioJob(app, {
          candidateId: sketch.candidateId,
          target,
          offset: checked.offset,
          duration: Math.min(checked.seconds, duration - checked.offset),
        }),
      );
    },
  },
];

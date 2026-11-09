// The track routes (decision 0061): a vibe's tracks, making one, reading one with its revisions
// and the vibe's sketches to place, saving an arrangement as a new revision, removing a track,
// rendering one section's window for its player on the timeline, and reading the features that
// render measured, which the material panel's arc draws (0066). An edit never changes a
// row: it appends a revision (0021). Rendering a whole track is 6c's.
/** @import { ArrangementContext, ArrangementSketch } from "../domain/validate-arrangement.js" */
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { Development } from "./development-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { Sketch } from "./rating-store.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
/** @import { TrackRevision } from "./track-store.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { ARRANGEMENT_KEY, emptyArrangement, SECTION_KEYS } from "../domain/arrangement-schema.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { currentExcerpt, excerptRequest } from "./candidate-excerpt.js";
import { jobRecordings } from "./candidate-job.js";
import { getDevelopment, listDevelopments } from "./development-store.js";
import { getGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { PRODUCER } from "./producer.js";
import { getSketch, listSketches } from "./rating-store.js";
import { renderExcerpt, vibeLoudness } from "./render-excerpt.js";
import { findRender } from "./render-store.js";
import { fields, idParam, MAX_CHARS, text } from "./request-fields.js";
import { duplicateJob, HttpError } from "./routing.js";
import { sketchParts } from "./track-manifest.js";
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
import { getVibe } from "./vibe-store.js";

const SECTION_AUDIO_JOB = JOB_KIND.sectionAudio;

/**
 * What `validateArrangement` reads of the sketches and developments, for track `trackId` of
 * `vibeId`.
 * @param {Store} store
 * @param {number} vibeId
 * @param {number | null} trackId null for an arrangement no track holds yet, a proposal's
 * @returns {ArrangementContext}
 */
export function arrangementContext(store, vibeId, trackId) {
  return {
    vibeId,
    trackId,
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
    development: (id) => {
      const found = getDevelopment(store, id);
      // A development's genome is checked to last its seconds when it is stored (0079).
      return (
        found && {
          trackId: found.trackId,
          sketchId: found.sketchId,
          removedReason: found.removedReason,
          duration: found.seconds,
        }
      );
    },
  };
}

/**
 * The arrangement checked against the vibe's sketches and the track's developments, or a 400
 * listing every error.
 * @param {Store} store
 * @param {{ id: number, vibeId: number }} track
 * @param {unknown} given
 */
export function checkedArrangement(store, track, given) {
  const checked = validateArrangement(given, arrangementContext(store, track.vibeId, track.id));
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
export function requireTrack(store, params) {
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
 * intent, its genome and the genome's duration, and its excerpt when one is cached. The page
 * reads the genomes to say why a morph would play as a crossfade (0064).
 * @param {App} app
 * @param {number} vibeId
 */
function trackMaterial(app, vibeId) {
  return listSketches(app.store, vibeId).map((sketch) => {
    const { candidate, genome, duration } = sketchParts(app.store, sketch);
    const excerpt = currentExcerpt(app.store, app.paths.renderCache, candidate);
    return {
      id: sketch.id,
      candidateId: sketch.candidateId,
      intent: candidate.intent,
      notes: sketch.notes,
      tags: sketch.tags,
      duration,
      genome,
      excerpt: excerpt && {
        renderId: excerpt.id,
        url: `/audio/${excerpt.id}`,
        offset: excerpt.offset,
        duration: excerpt.duration,
      },
    };
  });
}

/**
 * The track's live developments as the timeline reads them (decision 0079), oldest first, each
 * with its genome, so the page checks a developed section's window and morphs as the server
 * does.
 * @param {Store} store
 * @param {number} trackId
 */
function trackDevelopments(store, trackId) {
  return listDevelopments(store, trackId).map((development) => {
    const genome = getGenome(store, development.genomeId)?.genome;
    if (!genome) {
      throw new Error(`development ${development.id} names no genome ${development.genomeId}`);
    }
    const { id, sketchId, text, offset, seconds, createdAt } = development;
    return { id, sketchId, text, offset, seconds, createdAt, genome };
  });
}

/**
 * The job that renders one section's window of the genome it plays, its sketch's or its
 * development's, at that genome's seed, normalized to the vibe's loudness target, through the
 * excerpt path, so it is cached like an excerpt. The window stops at the genome's end: playing
 * an extended part needs 6c's section genome.
 * @param {App} app
 * @param {ExcerptRequest & { offset: number, duration: number }} request
 */
function sectionAudioJob(app, { genomeId, seed, target, offset, duration }) {
  return async (/** @type {JobContext} */ job) => {
    job.progress(0, 1, JOB_STEP.renderingSection(duration));
    job.signal.throwIfAborted();
    const recordings = await jobRecordings(app);
    const { render, cached } = await renderExcerpt(
      app.store,
      app.paths.renderCache,
      { genomeId, seed, target },
      recordings,
      { offset, duration },
    );
    job.progress(1, 1, null);
    return { renderId: render.id, url: `/audio/${render.id}`, offset, duration, cached };
  };
}

/**
 * The window a section's player renders and its measures are read from: the section checked as
 * an arrangement of one, so it is held to the same rules as a saved one, at the vibe's current
 * loudness, of the genome it plays, its development's when it has one (0079), cut at that
 * genome's end. A malformed section is a 400 naming its path.
 * @param {Store} store
 * @param {{ id: number, vibeId: number }} track
 * @param {{ revision: { constraints: unknown } }} vibe
 * @param {unknown} given
 * @returns {ExcerptRequest & { offset: number, duration: number }}
 */
function sectionWindow(store, track, vibe, given) {
  const [checked] = checkedArrangement(store, track, {
    ...emptyArrangement(),
    sections: [given],
  }).sections;
  if (!checked) throw new Error("an arrangement of one section came back with none");
  // A stored revision passed validateConstraints, so the cast holds.
  const target = vibeLoudness(/** @type {Constraints} */ (vibe.revision.constraints));
  const window = (/** @type {number} */ duration) => ({
    offset: checked.offset,
    duration: Math.min(checked.seconds, duration - checked.offset),
  });
  if (checked.developmentId !== null) {
    const development = /** @type {Development} */ (getDevelopment(store, checked.developmentId));
    const { genomeId, seed, seconds } = development;
    return { genomeId, seed, target, ...window(seconds) };
  }
  const sketch = /** @type {Sketch} */ (getSketch(store, checked.sketchId));
  const { candidate, duration } = sketchParts(store, sketch);
  const request = excerptRequest(store, candidate);
  if (!request) throw new Error(`candidate ${candidate.id} has no genome to render`);
  return { genomeId: request.genomeId, seed: request.seed, target, ...window(duration) };
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
        developments: trackDevelopments(app.store, track.id),
      };
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/revisions",
    handle: async ({ app, params, body }) => {
      const { track } = requireTrack(app.store, params);
      const given = fields(await body(), Object.values(TRACK_REVISION_FIELD));
      const arrangement = checkedArrangement(app.store, track, given.arrangement);
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
      const window = sectionWindow(app.store, track, vibe, fields(await body(), SECTION_KEYS));
      const unfinished = app.jobs
        .list()
        .find((job) => job.kind === SECTION_AUDIO_JOB && job.finishedAt === null);
      if (unfinished) {
        throw duplicateJob(
          `A section is already being rendered to play (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      return app.jobs.add(SECTION_AUDIO_JOB, sectionAudioJob(app, window));
    },
  },
  {
    // A read sent as a POST, so a long track's sections go in the body rather than a URL that
    // could pass Node's header limit. It writes nothing and starts no job.
    method: "POST",
    path: "/api/tracks/:trackId/measures",
    handle: async ({ app, params, body }) => {
      const { track, vibe } = requireTrack(app.store, params);
      const { sections } = fields(await body(), [ARRANGEMENT_KEY.sections]);
      if (!Array.isArray(sections)) {
        throw new HttpError(400, "sections must be a list of sections");
      }
      return {
        measures: sections.map((given) => {
          const window = sectionWindow(app.store, track, vibe, given);
          const render = findRender(app.store, { ...window, producer: PRODUCER });
          return render?.features ?? null;
        }),
      };
    },
  },
];

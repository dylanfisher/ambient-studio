// The develop routes (decisions 0079, 0081): asking the model to develop one section of a saved
// version of a track, or to write a bridge for one of its joins, each as an owner-started job,
// one at a time. The job stores the development; the timeline puts it in place and saves the new
// version.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { App, Route } from "./routing.js" */
import { BRIDGE_SECONDS, bridgePlan } from "../domain/bridge-plan.js";
import { DEVELOP_LEAST } from "../domain/develop-prompt.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { bridgeJob } from "./bridge-section.js";
import { developJob } from "./develop-section.js";
import { fields, finite, integer, rowId } from "./request-fields.js";
import { HttpError, refuseUnfinished } from "./routing.js";
import { sectionSources } from "./track-manifest.js";
import { checkedArrangement, requireTrack } from "./track-routes.js";
import { listTrackRevisions } from "./track-store.js";

const DEVELOP_JOB = JOB_KIND.developSection;

/** The body's keys: the saved version, and its section, counted from 0. */
const DEVELOP_FIELD = Object.freeze({ revisionId: "revisionId", section: "section" });

/** The bridge's body: the saved version, its transition counted from 0, and the seconds. */
const BRIDGE_FIELD = Object.freeze({
  revisionId: "revisionId",
  transition: "transition",
  seconds: "seconds",
});

/**
 * The track and its saved version the body names, checked.
 * @param {App} app
 * @param {Record<string, string>} params
 * @param {Record<string, unknown>} given
 * @returns {{ track: { id: number, vibeId: number }, revisionId: number, arrangement: Arrangement }}
 */
function savedVersion(app, params, given) {
  const { track } = requireTrack(app.store, params);
  const revisionId = rowId(given, DEVELOP_FIELD.revisionId);
  const revision = listTrackRevisions(app.store, track.id).find(({ id }) => id === revisionId);
  if (!revision) throw new HttpError(404, `track ${track.id} has no version ${revisionId}`);
  return {
    track,
    revisionId,
    arrangement: checkedArrangement(app.store, track, revision.arrangement),
  };
}

/**
 * Refuses a develop or a bridge job while either is unfinished: both are placed by windows the
 * other may change.
 * @param {App} app
 */
function refuseDeveloping(app) {
  refuseUnfinished(
    app,
    DEVELOP_JOB,
    (id) =>
      `A section is already being developed (job ${id}). Wait for it to finish, or cancel it.`,
  );
  refuseUnfinished(
    app,
    JOB_KIND.bridge,
    (id) => `A bridge is already being written (job ${id}). Wait for it to finish, or cancel it.`,
  );
}

/** @type {Route[]} */
export const DEVELOP_ROUTES = [
  {
    method: "POST",
    path: "/api/tracks/:trackId/develop",
    handle: async ({ app, params, body }) => {
      const given = fields(await body(), Object.values(DEVELOP_FIELD));
      const { track, revisionId, arrangement } = savedVersion(app, params, given);
      const { length } = arrangement.sections;
      if (length === 0) {
        throw new HttpError(400, "This version has no sections to develop. Add a sketch first.");
      }
      const index = integer(given, DEVELOP_FIELD.section, { min: 0, max: length - 1 });
      const { seconds } = /** @type {Section} */ (arrangement.sections[index]);
      if (seconds < DEVELOP_LEAST) {
        throw new HttpError(
          409,
          `Section ${index + 1} plays ${seconds} s; a section must play at least ${DEVELOP_LEAST} s to be developed, since a genome lasts at least that long.`,
        );
      }
      refuseDeveloping(app);
      return app.jobs.add(DEVELOP_JOB, developJob(app, { track, revisionId, arrangement, index }));
    },
  },
  {
    method: "POST",
    path: "/api/tracks/:trackId/bridge",
    handle: async ({ app, params, body }) => {
      const given = fields(await body(), Object.values(BRIDGE_FIELD));
      const { track, revisionId, arrangement } = savedVersion(app, params, given);
      const { length } = arrangement.transitions;
      if (length === 0) {
        throw new HttpError(400, "This version has no join to bridge. Add a second sketch first.");
      }
      const index = integer(given, BRIDGE_FIELD.transition, { min: 0, max: length - 1 });
      const seconds = finite(given, BRIDGE_FIELD.seconds, {
        min: BRIDGE_SECONDS.min,
        max: BRIDGE_SECONDS.max,
      });
      const plan = bridgePlan(
        arrangement,
        index,
        seconds,
        sectionSources(app.store, arrangement).genomes,
      );
      if (!plan.ok) throw new HttpError(409, `Can't bridge this join: ${plan.reason}.`);
      refuseDeveloping(app);
      const { ok: _, ...laid } = plan;
      return app.jobs.add(
        JOB_KIND.bridge,
        bridgeJob(app, { track, revisionId, arrangement, index, plan: laid }),
      );
    },
  },
];

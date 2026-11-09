// The develop route (decision 0079): asking the model to develop one section of a saved version
// of a track, as an owner-started job, one at a time. The job stores the development; the
// timeline puts it in its section and saves the new version.
/** @import { Section } from "../domain/arrangement-schema.js" */
/** @import { Route } from "./routing.js" */
import { DEVELOP_LEAST } from "../domain/develop-prompt.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { developJob } from "./develop-section.js";
import { fields, integer, rowId } from "./request-fields.js";
import { HttpError, refuseUnfinished } from "./routing.js";
import { checkedArrangement, requireTrack } from "./track-routes.js";
import { listTrackRevisions } from "./track-store.js";

const DEVELOP_JOB = JOB_KIND.developSection;

/** The body's keys: the saved version, and its section, counted from 0. */
const DEVELOP_FIELD = Object.freeze({ revisionId: "revisionId", section: "section" });

/** @type {Route[]} */
export const DEVELOP_ROUTES = [
  {
    method: "POST",
    path: "/api/tracks/:trackId/develop",
    handle: async ({ app, params, body }) => {
      const { track } = requireTrack(app.store, params);
      const given = fields(await body(), Object.values(DEVELOP_FIELD));
      const revisionId = rowId(given, DEVELOP_FIELD.revisionId);
      const revision = listTrackRevisions(app.store, track.id).find(({ id }) => id === revisionId);
      if (!revision) throw new HttpError(404, `track ${track.id} has no version ${revisionId}`);
      const arrangement = checkedArrangement(app.store, track, revision.arrangement);
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
      refuseUnfinished(
        app,
        DEVELOP_JOB,
        (id) =>
          `A section is already being developed (job ${id}). Wait for it to finish, or cancel it.`,
      );
      return app.jobs.add(DEVELOP_JOB, developJob(app, { track, revisionId, arrangement, index }));
    },
  },
];

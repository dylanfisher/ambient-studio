// The proposal routes (decision 0067): asking the model to propose a new track from a length,
// an arc and, optionally, an attached region to follow, as an owner-started job, one at a time;
// and how the brief's proposals so far came out, for acceptance 8's share.
/** @import { Route } from "./routing.js" */
import { ARRANGEMENT_KEY, emptyArrangement } from "../domain/arrangement-schema.js";
import { REGION_KEY } from "../domain/attachment-kind.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { arcRegion, proposalShare, proposeJob } from "./propose-track.js";
import { fields, MAX_CHARS, rowId, text } from "./request-fields.js";
import { duplicateJob, HttpError } from "./routing.js";
import { arrangementContext } from "./track-routes.js";
import { requireVibe } from "./vibe-routes.js";

const PROPOSE_JOB = JOB_KIND.propose;

/** @type {Route[]} */
export const PROPOSAL_ROUTES = [
  {
    method: "POST",
    path: "/api/vibes/:vibeId/proposals",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), [
        "name",
        ARRANGEMENT_KEY.length,
        ARRANGEMENT_KEY.arc,
        REGION_KEY,
      ]);
      const name = text(given, "name", MAX_CHARS.name);
      const { length, arc } = given;
      if (typeof length !== "number" || typeof arc !== "string") {
        throw new HttpError(400, "a proposal needs a length in seconds and an arc in words");
      }
      // The arrangement's own checks say what a length and an arc may be.
      const asked = validateArrangement(
        { ...emptyArrangement(), length, arc },
        arrangementContext(app.store, vibe.id, null),
      );
      if (!asked.ok) {
        const list = asked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
        throw new HttpError(400, `the proposal's ask is invalid: ${list}`);
      }
      const regionId = given[REGION_KEY] == null ? null : rowId(given, REGION_KEY);
      if (regionId !== null) {
        try {
          arcRegion(app.store, vibe.id, regionId);
        } catch (error) {
          throw new HttpError(409, /** @type {Error} */ (error).message);
        }
      }
      const unfinished = app.jobs
        .list()
        .find((job) => job.kind === PROPOSE_JOB && job.finishedAt === null);
      if (unfinished) {
        throw duplicateJob(
          `A track is already being proposed (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      return app.jobs.add(
        PROPOSE_JOB,
        proposeJob(app, { vibeId: vibe.id, name, length, arc, regionId }),
      );
    },
  },
  {
    method: "GET",
    path: "/api/vibes/:vibeId/proposals",
    handle: ({ app, params }) => proposalShare(app.store, requireVibe(app.store, params).id),
  },
];

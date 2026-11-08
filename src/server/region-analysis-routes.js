// The region analysis routes (decision 0051): list every live region for the brief page, read a
// region's stored analysis at a loudness target, and start the Analyze job. The target is the
// brief's when the request names one, and 0018's default on the References page.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { JOB_KIND } from "../domain/job-kind.js";
import { GLOBAL_PARAMS } from "../engine/genome-schema.js";
import { analyzeRegionJob } from "./analyze-region-job.js";
import { PRODUCER } from "./producer.js";
import { requireRegion } from "./reference-routes.js";
import { listAllRegions, listReferenceFiles } from "./reference-store.js";
import { findRegionAnalysis } from "./region-analysis-store.js";
import { vibeLoudness } from "./render-excerpt.js";
import { fields, rowId } from "./request-fields.js";
import { duplicateJob } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

const ANALYZE_JOB = JOB_KIND.analyze;

/**
 * The loudness target a region is analyzed at: the brief's, or 0018's default without one.
 * @param {Store} store
 * @param {string | null} vibeId the request's, as text
 * @returns {number} LUFS
 */
function targetFor(store, vibeId) {
  if (vibeId === null) return GLOBAL_PARAMS.loudness.default;
  const { revision } = requireVibe(store, { vibeId });
  // Stored revisions passed validateConstraints, so the cast holds.
  return vibeLoudness(/** @type {Constraints} */ (revision.constraints));
}

/**
 * The Analyze job that is queued or running, if any.
 * @param {App} app
 */
const unfinishedJob = (app) =>
  app.jobs.list().find((job) => job.kind === ANALYZE_JOB && job.finishedAt === null) ?? null;

/** @type {Route[]} */
export const REGION_ANALYSIS_ROUTES = [
  {
    method: "GET",
    path: "/api/reference-regions",
    handle: ({ app }) => ({
      references: listReferenceFiles(app.store),
      regions: listAllRegions(app.store),
    }),
  },
  {
    method: "GET",
    path: "/api/reference-regions/:regionId/analysis",
    handle: ({ app, params, query }) => {
      const { region } = requireRegion(app.store, params);
      const target = targetFor(app.store, query.get("vibeId"));
      const analysis = findRegionAnalysis(app.store, {
        regionId: region.id,
        target,
        producer: PRODUCER,
      });
      return {
        regionId: region.id,
        target,
        analysis: analysis
          ? { windows: analysis.windows, embedded: analysis.embedding !== null }
          : null,
      };
    },
  },
  {
    method: "POST",
    path: "/api/reference-regions/:regionId/analyze",
    handle: async ({ app, params, body }) => {
      const { region } = requireRegion(app.store, params);
      const given = fields(await body(), ["vibeId"]);
      const vibeId = given.vibeId === undefined ? null : String(rowId(given, "vibeId"));
      const target = targetFor(app.store, vibeId);
      // One at a time: two would decode and measure the same region twice.
      const unfinished = unfinishedJob(app);
      if (unfinished) {
        throw duplicateJob(
          `A region is already being analyzed (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
          unfinished.id,
        );
      }
      return app.jobs.add(ANALYZE_JOB, analyzeRegionJob(app, { regionId: region.id, target }));
    },
  },
];

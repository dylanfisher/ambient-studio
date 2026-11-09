// Develops every section of a track (decision 0082): TD.3's request (0079) for each section the
// plan develops, in order, one at a time through the job's own queue. Each development is
// stored as soon as it is written and put in its section at offset 0 for the requests after it,
// so the next section's prompt meets it as it will play; a cancel or a failure keeps those
// already stored. Nothing is rendered and no revision is written: the timeline places them. It
// runs only when the owner's route adds it.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { DevelopPlan } from "../domain/develop-plan.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { DEVELOP_PLAN } from "../domain/develop-plan.js";
import { developSection } from "./develop-section.js";
import { ownedBy } from "./omlx-queue.js";

/**
 * What the owner asked for: every section of one saved revision, checked by the route.
 * @typedef {object} DevelopTrackRequest
 * @property {{ id: number, vibeId: number }} track
 * @property {number} revisionId
 * @property {Arrangement} arrangement the revision's, valid
 * @property {DevelopPlan[]} plan `developPlan` of it, with at least one section to develop
 */

/**
 * @param {App} app
 * @param {DevelopTrackRequest} request
 * @returns {(job: JobContext) => Promise<{ trackId: number, revisionId: number,
 *   plan: DevelopPlan[], developed: { index: number, developmentId: number }[] }>}
 */
export function developTrackJob(app, { track, revisionId, arrangement, plan }) {
  return async (job) => {
    const queue = ownedBy(app.queue, job.signal);
    const cancelRequests = () => queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      const indices = plan.flatMap((kind, i) => (kind === DEVELOP_PLAN.develop ? [i] : []));
      /** @type {{ index: number, developmentId: number }[]} */
      const developed = [];
      let working = arrangement;
      for (const [done, index] of indices.entries()) {
        job.signal.throwIfAborted();
        const { development } = await developSection(app, job, {
          track,
          arrangement: working,
          index,
          queue,
          progress: { done, of: indices.length },
        });
        developed.push({ index, developmentId: development.id });
        working = {
          ...working,
          sections: working.sections.map((section, i) =>
            i === index ? { ...section, offset: 0, developmentId: development.id } : section,
          ),
        };
      }
      job.progress(indices.length, indices.length, null);
      return { trackId: track.id, revisionId, plan, developed };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

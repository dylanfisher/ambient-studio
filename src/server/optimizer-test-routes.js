// The optimizer test's routes (decision 0059): start the test, which nothing else starts; read
// the stored tests with the owner's choices on their spot-check pairs counted from the ratings
// as they stand; and list a session's spot-check pairs for Quick A/B, each with its sides drawn
// from the seed the test stored.
/** @import { Evaluation } from "./evaluation-store.js" */
/** @import { StoredSpotPair } from "./optimizer-test-job.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { abOrder } from "../domain/ab-order.js";
import { applyLocks } from "../domain/apply-locks.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { lockRefusal } from "../domain/nudge.js";
import { OPTIMIZER_TEST, ownerTally, pairRating } from "../domain/optimizer-report.js";
import { DEFAULT_SEARCH_BUDGET, MAX_SEARCH_BUDGET } from "../domain/search-settings.js";
import { searchSpace } from "../domain/search-space.js";
import { show } from "../engine/validation-error.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import { EVALUATION_KIND, listEvaluations } from "./evaluation-store.js";
import { currentRevision } from "./generate-candidates.js";
import { getCandidate } from "./generation-store.js";
import { vibeCandidate } from "./lock-routes.js";
import { locksInForce } from "./lock-store.js";
import { modelCheck, optimizerTestJob } from "./optimizer-test-job.js";
import { listRatings } from "./rating-store.js";
import { fields, idParam, integer, rowId } from "./request-fields.js";
import { duplicateJob, HttpError } from "./routing.js";
import { searchEstimate } from "./search-job.js";
import { getSession } from "./session-store.js";
import { getVibe } from "./vibe-store.js";

const TEST_JOB = JOB_KIND.optimizerTest;

/** @param {App} app */
const unfinishedJob = (app) =>
  app.jobs.list().find((job) => job.kind === TEST_JOB && job.finishedAt === null) ?? null;

/**
 * A 409 naming the unfinished test, if any: one at a time, since a second would run the same
 * searches again.
 * @param {App} app
 */
function refuseDuplicate(app) {
  const unfinished = unfinishedJob(app);
  if (unfinished) {
    throw duplicateJob(
      `The optimizer test is already queued or running (job ${unfinished.id}). Wait for it to finish, or cancel it.`,
      unfinished.id,
    );
  }
}

/**
 * A base the owner picked: a live candidate of the brief in an open session, which takes the
 * live locks and leaves a macro to search.
 * @param {Store} store
 * @param {number} vibeId
 * @param {number} candidateId
 */
function pickedBase(store, vibeId, candidateId) {
  const { candidate, genome } = vibeCandidate(store, vibeId, candidateId);
  const session = candidate.sessionId === null ? undefined : getSession(store, candidate.sessionId);
  if (!session || session.stoppedAt !== null) {
    throw new HttpError(
      409,
      `candidate ${candidateId} isn't in an open session, and a search adds its points to the base's session`,
    );
  }
  const locks = locksInForce(store, vibeId);
  const applied = applyLocks(genome, locks);
  const refused = lockRefusal(applied);
  if (refused !== null) throw new HttpError(409, `candidate ${candidateId} ${refused}`);
  const { constraints } = currentRevision(store, vibeId);
  if (searchSpace(applied.genome, locks, constraints, []).length === 0) {
    throw new HttpError(
      409,
      `Every macro of candidate ${candidateId} is locked or fixed by the brief, so there is nothing to search. Unlock a macro first.`,
    );
  }
  return candidateId;
}

/**
 * The body's `vibes`: at least one brief not removed, none twice, each with at most
 * `OPTIMIZER_TEST.runs` bases, or none for its top-ranked candidates.
 * @param {Store} store
 * @param {Record<string, unknown>} body
 * @returns {{ vibeId: number, candidateIds: number[] }[]}
 */
function readVibes(store, body) {
  const { vibes } = body;
  if (!Array.isArray(vibes) || vibes.length === 0) {
    throw new HttpError(400, `vibes must list at least one brief, got ${show(vibes)}`);
  }
  /** @type {Set<number>} */
  const seen = new Set();
  return vibes.map((entry, i) => {
    const given = fields(entry, ["vibeId", "candidateIds"]);
    const vibeId = rowId(given, "vibeId");
    const vibe = getVibe(store, vibeId);
    if (!vibe || vibe.removedAt !== null) {
      throw new HttpError(400, `vibes[${i}]: there is no brief ${vibeId}`);
    }
    if (seen.has(vibeId)) throw new HttpError(400, `vibes lists brief ${vibeId} twice`);
    seen.add(vibeId);
    const ids = given.candidateIds ?? [];
    if (!Array.isArray(ids) || ids.length > OPTIMIZER_TEST.runs) {
      throw new HttpError(
        400,
        `vibes[${i}].candidateIds must list at most ${OPTIMIZER_TEST.runs} candidates, got ${show(ids)}`,
      );
    }
    const candidateIds = ids.map((_, j) =>
      rowId({ [`candidateIds[${j}]`]: ids[j] }, `candidateIds[${j}]`),
    );
    if (new Set(candidateIds).size < candidateIds.length) {
      throw new HttpError(400, `vibes[${i}].candidateIds lists a candidate twice`);
    }
    return { vibeId, candidateIds: candidateIds.map((id) => pickedBase(store, vibeId, id)) };
  });
}

/**
 * A stored test with the owner's choices on each brief's spot-check pairs counted, and each
 * session's pairs not yet rated.
 * @param {App} app
 * @param {Evaluation} evaluation
 */
function withChoices(app, evaluation) {
  const report = /** @type {{ vibes: { vibeId: number, spotChecks: StoredSpotPair[] }[] }} */ (
    evaluation.report
  );
  return {
    ...evaluation,
    report: {
      ...report,
      vibes: report.vibes.map((vibe) => {
        const ratings = listRatings(app.store, vibe.vibeId);
        /** @type {Map<number, number>} */
        const unrated = new Map();
        for (const pair of vibe.spotChecks) {
          const count = unrated.get(pair.sessionId) ?? 0;
          unrated.set(pair.sessionId, count + (pairRating(pair, ratings) === null ? 1 : 0));
        }
        return {
          ...vibe,
          owner: ownerTally(vibe.spotChecks, ratings),
          sessions: [...unrated].map(([sessionId, left]) => ({ sessionId, unrated: left })),
        };
      }),
    },
  };
}

/**
 * A spot-check side as Quick A/B plays it, or null when its excerpt isn't in the render cache.
 * @param {App} app
 * @param {number} candidateId
 */
function playable(app, candidateId) {
  const candidate = getCandidate(app.store, candidateId);
  if (!candidate)
    throw new Error(`a spot-check pair names candidate ${candidateId}, which is gone`);
  const render = currentExcerpt(app.store, app.paths.renderCache, candidate);
  if (render === null) return null;
  return {
    id: candidateId,
    genomeId: render.genomeId,
    seed: candidate.seed,
    excerpt: { renderId: render.id, url: `/audio/${render.id}`, duration: render.duration },
  };
}

/** @type {Route[]} */
export const OPTIMIZER_TEST_ROUTES = [
  {
    method: "GET",
    path: "/api/optimizer-tests",
    handle: async ({ app }) => ({
      tests: listEvaluations(app.store, EVALUATION_KIND.optimizer).map((evaluation) =>
        withChoices(app, evaluation),
      ),
      job: unfinishedJob(app),
      estimate: await searchEstimate(app.paths.search),
    }),
  },
  {
    method: "POST",
    path: "/api/optimizer-tests",
    handle: async ({ app, body }) => {
      const given = fields(await body(), ["vibes", "budget"]);
      const vibes = readVibes(app.store, given);
      const budget =
        given.budget === undefined
          ? DEFAULT_SEARCH_BUDGET
          : integer(given, "budget", { min: 1, max: MAX_SEARCH_BUDGET });
      refuseDuplicate(app);
      // Checked here so a test of briefs that all have no model is refused before it is added;
      // the job checks each again when it reaches it, and leaves out one that lost its model.
      const reasons = [];
      for (const { vibeId } of vibes) {
        const { reason } = await modelCheck(app, vibeId, new AbortController().signal);
        reasons.push(
          reason === null ? null : `${getVibe(app.store, vibeId)?.revision.name}: ${reason}`,
        );
      }
      if (reasons.every((reason) => reason !== null)) {
        throw new HttpError(409, `No chosen brief can be tested. ${reasons.join(" ")}`);
      }
      // Again with no await before the add, so two requests at once give one job (0031).
      refuseDuplicate(app);
      return app.jobs.add(TEST_JOB, optimizerTestJob(app, { vibes, budget }));
    },
  },
  {
    method: "GET",
    path: "/api/sessions/:sessionId/spot-checks",
    handle: ({ app, params }) => {
      const sessionId = idParam(params, "sessionId");
      const session = getSession(app.store, sessionId);
      if (!session) throw new HttpError(404, `there is no session ${sessionId}`);
      const ratings = listRatings(app.store, session.vibeId);
      const pairs = listEvaluations(app.store, EVALUATION_KIND.optimizer).flatMap((evaluation) => {
        const { vibes } = /** @type {{ vibes: { spotChecks: StoredSpotPair[] }[] }} */ (
          evaluation.report
        );
        return vibes.flatMap(({ spotChecks }) =>
          spotChecks
            .filter((pair) => pair.sessionId === sessionId)
            .map((pair) => {
              const a = playable(app, pair.search.candidateId);
              const b = playable(app, pair.control.candidateId);
              return {
                evaluationId: evaluation.id,
                run: pair.run,
                rank: pair.rank,
                rated: pairRating(pair, ratings) !== null,
                // The search is side a; which side is shown on the left comes from the seed.
                pair:
                  a && b
                    ? {
                        a: a.excerpt.renderId,
                        b: b.excerpt.renderId,
                        orderSeed: pair.orderSeed,
                        leftSide: abOrder(pair.orderSeed),
                      }
                    : null,
                a,
                b,
              };
            }),
        );
      });
      return { sessionId, stopped: session.stoppedAt !== null, pairs };
    },
  },
];

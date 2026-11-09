// A vibe's lineage (decision 0039): every candidate made in one of its sessions, with its
// parents, so the lineage page can draw the tree. Evaluation candidates (no session) and 3h's
// control-arm revisions are left out, and an unchanged revision is folded into its first try,
// as the session page leaves it out (0036): a node made from one sits under the first try. And
// the features of every live excerpt of the vibe, which the session page compares each
// candidate with in words (0085).
/** @import { Candidate } from "./generation-store.js" */
/** @import { Route } from "./routing.js" */
import { currentExcerpt } from "./candidate-excerpt.js";
import { candidatePairs } from "./candidate-pair.js";
import { listSessionCandidates } from "./generation-store.js";
import { FEEDBACK_KIND, listFeedback, listRatings, listSketches } from "./rating-store.js";
import { REVISE_CONTROL } from "./revise-candidate.js";
import { HttpError } from "./routing.js";
import { listSessions } from "./session-store.js";
import { vibeCandidates } from "./vibe-archive.js";
import { requireVibe } from "./vibe-routes.js";

/** The query parameter that lists rejected candidates too. */
const REJECTED = "includeRejected";

/**
 * Whether the query asks for rejected candidates: `true` or `false`, false when absent.
 * @param {URLSearchParams} query
 */
function withRejected(query) {
  const value = query.get(REJECTED);
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  throw new HttpError(400, `${REJECTED} must be true or false, got ${JSON.stringify(value)}`);
}

/**
 * Whether two rows name the same heard genome and seed.
 * @param {{ genomeId: number | null, seed: number }} a
 * @param {{ genomeId: number | null, seed: number }} b
 */
const sameHeard = (a, b) => a.genomeId === b.genomeId && a.seed === b.seed;

/** @type {Route[]} */
export const LINEAGE_ROUTES = [
  {
    method: "GET",
    path: "/api/vibes/:vibeId/lineage",
    handle: ({ app, params, query }) => {
      const vibe = requireVibe(app.store, params);
      const rejected = withRejected(query);
      const listed = listSessions(app.store, vibe.id)
        .flatMap((session) => listSessionCandidates(app.store, session.id))
        .filter((candidate) => candidate.operator !== REVISE_CONTROL)
        .sort((a, b) => a.id - b.id)
        .map((candidate) => ({
          candidate,
          excerpt: currentExcerpt(app.store, app.paths.renderCache, candidate),
        }));
      const { pairs, folded } = candidatePairs(app.store, listed);
      /** @type {Map<number, Candidate>} */
      const byId = new Map(listed.map(({ candidate }) => [candidate.id, candidate]));
      /** @param {unknown} id a parent id, mapped to its first try when it was folded */
      const parentOf = (id) =>
        typeof id === "number" && folded.has(id) ? byId.get(id)?.parentIds[0] : id;
      const feedback = listFeedback(app.store, vibe.id).filter(
        (row) => row.kind === FEEDBACK_KIND.thumbs,
      );
      const ratings = listRatings(app.store, vibe.id);
      const sketched = new Set(listSketches(app.store, vibe.id).map((row) => row.candidateId));
      const nodes = listed
        .filter(({ candidate }) => !folded.has(candidate.id))
        .filter(({ candidate }) => rejected || candidate.rejectReason === null)
        .map(({ candidate, excerpt }) => {
          const { id, sessionId, genomeId, seed, operator, operatorParams, intent } = candidate;
          // The newest live thumbs row is the candidate's choice (0031 keeps one live).
          const thumbs = feedback.findLast((row) => sameHeard(row, candidate))?.direction ?? null;
          const compared = ratings.filter(
            ({ a, b }) => sameHeard(a, candidate) || sameHeard(b, candidate),
          ).length;
          return {
            id,
            sessionId,
            genomeId,
            seed,
            parentIds: candidate.parentIds.map(parentOf),
            operator,
            operatorParams,
            intent,
            rejectReason: candidate.rejectReason,
            createdAt: candidate.createdAt,
            pair: pairs.get(id) ?? null,
            excerpt: excerpt && {
              renderId: excerpt.id,
              url: `/audio/${excerpt.id}`,
              duration: excerpt.duration,
            },
            marks: { thumbs, compared },
            sketch: sketched.has(id),
          };
        });
      return { nodes };
    },
  },
  {
    method: "GET",
    path: "/api/vibes/:vibeId/excerpt-features",
    handle: ({ app, params }) => {
      const vibe = requireVibe(app.store, params);
      /** @type {Map<number, unknown>} each excerpt's features by render, once */
      const byRender = new Map();
      for (const candidate of vibeCandidates(app.store, vibe.id)) {
        const excerpt = currentExcerpt(app.store, app.paths.renderCache, candidate);
        if (excerpt) byRender.set(excerpt.id, excerpt.features);
      }
      return {
        excerpts: [...byRender].map(([renderId, features]) => ({ renderId, features })),
      };
    },
  },
];

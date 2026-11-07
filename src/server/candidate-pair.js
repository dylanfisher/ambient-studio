// Which card of a revised pair the session shows (decision 0036): the owner's rule is the one
// that misses fewer of the vibe's feature ranges and render checks, the revision on a tie.
// Always showing the revision would hide the cases where it got worse.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { Render } from "./render-store.js" */
/** @import { Store } from "./store.js" */
import { excerptMisses } from "../domain/excerpt-misses.js";
import { checkRevision } from "./generate-candidates.js";
import { isUnchanged, REVISE } from "./revise-candidate.js";
import { getRevision } from "./vibe-store.js";

/**
 * A first try and its revision, and which of the two the session shows.
 * @typedef {{ firstTryId: number, revisionId: number, shownId: number }} Pair
 */

/** @typedef {{ candidate: Candidate, excerpt: Render | null }} Listed */

/**
 * The pairs among a session's candidates, by the id of each member, and the revisions the
 * session leaves out: an unchanged one, which has no card of its own. A rejected revision makes
 * no pair. Until both excerpts are measured, the first try is shown.
 * @param {Store} store
 * @param {readonly Listed[]} listed each candidate with its current excerpt
 * @returns {{ pairs: Map<number, Pair>, folded: Set<number> }}
 */
export function candidatePairs(store, listed) {
  const byId = new Map(listed.map((entry) => [entry.candidate.id, entry]));
  /** @type {Map<number, FeatureRanges>} */
  const ranges = new Map();
  /** @param {Candidate} candidate */
  const rangesOf = (candidate) => {
    const id = candidate.vibeRevisionId;
    const known = ranges.get(id);
    if (known) return known;
    const revision = getRevision(store, id);
    if (!revision) throw new Error(`there is no vibe revision ${id}`);
    const checked = checkRevision(revision).ranges;
    ranges.set(id, checked);
    return checked;
  };
  /** @param {Listed} entry */
  const misses = ({ candidate, excerpt }) =>
    excerpt &&
    excerptMisses(
      /** @type {Features} */ (excerpt.features),
      /** @type {LintResult} */ (excerpt.checks),
      rangesOf(candidate),
    ).length;

  /** @type {Map<number, Pair>} */
  const pairs = new Map();
  /** @type {Set<number>} */
  const folded = new Set();
  for (const entry of listed) {
    const revision = entry.candidate;
    if (revision.operator !== REVISE) continue;
    if (isUnchanged(revision)) {
      folded.add(revision.id);
      continue;
    }
    const first = byId.get(/** @type {number} */ (revision.parentIds[0]));
    if (revision.genomeId === null || !first) continue;
    const before = misses(first);
    const after = misses(entry);
    const revisionShown = before !== null && after !== null && after <= before;
    const pair = {
      firstTryId: first.candidate.id,
      revisionId: revision.id,
      shownId: revisionShown ? revision.id : first.candidate.id,
    };
    pairs.set(pair.firstTryId, pair);
    pairs.set(pair.revisionId, pair);
  }
  return { pairs, folded };
}

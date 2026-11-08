// Which excerpt a candidate is heard as (decisions 0026 and 0027): its genome at its seed,
// normalized to the loudness target of the revision it was made under.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { Render } from "./render-store.js" */
/** @import { Store } from "./store.js" */
import { EXCERPT_SECONDS } from "../domain/excerpt-seconds.js";
import { excerptOffset } from "../engine/excerpt-offset.js";
import { getGenome } from "./generation-store.js";
import { PRODUCER } from "./producer.js";
import { cachedFile, vibeLoudness } from "./render-excerpt.js";
import { findRender } from "./render-store.js";
import { getRevision } from "./vibe-store.js";

/**
 * What to render for the candidate, or null when it has no genome to render.
 * @param {Store} store
 * @param {Candidate} candidate
 * @returns {ExcerptRequest | null}
 */
export function excerptRequest(store, { genomeId, seed, vibeRevisionId }) {
  if (genomeId === null) return null;
  const revision = getRevision(store, vibeRevisionId);
  if (!revision) throw new Error(`there is no vibe revision ${vibeRevisionId}`);
  // A revision's constraints were checked by 2b's validator when the route stored them.
  const target = vibeLoudness(/** @type {Constraints} */ (revision.constraints));
  return { genomeId, seed, target };
}

/**
 * The candidate's cached excerpt under this server's producer, or null when it has no genome or
 * its excerpt hasn't been rendered under this producer and target, or its file is gone or is a
 * WAV from before excerpts were MP3s.
 * @param {Store} store
 * @param {string} folder the render-cache folder
 * @param {Candidate} candidate
 * @returns {Render | null}
 */
export function currentExcerpt(store, folder, candidate) {
  const request = excerptRequest(store, candidate);
  if (!request) return null;
  const row = getGenome(store, request.genomeId);
  if (!row) throw new Error(`there is no genome ${request.genomeId}`);
  const duration = EXCERPT_SECONDS;
  const offset = excerptOffset(row.genome, request.seed, duration);
  const found = findRender(store, { ...request, offset, duration, producer: PRODUCER });
  return found && cachedFile(folder, found) ? found : null;
}

/**
 * Whether a render is its genome's excerpt at its seed, the window a candidate is rated on,
 * rather than another window such as a track section's (decision 0061). The renders table
 * holds both; whatever reads excerpts only, such as the embed job, keeps to these.
 * @param {Store} store
 * @param {Render} render
 */
export function isExcerptWindow(store, { genomeId, seed, offset, duration }) {
  if (duration !== EXCERPT_SECONDS) return false;
  const row = getGenome(store, genomeId);
  if (!row) throw new Error(`there is no genome ${genomeId}`);
  return offset === excerptOffset(row.genome, seed, duration);
}

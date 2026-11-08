// A session's candidates ranked by its brief's taste model (decision 0046): every excerpt of the
// session with a sound analysis under the current embedder, scored by the sidecar's `predict`
// under the model at the brief's current key, ordered by `rankCandidates`, and kept with the
// full covariance the pair picker reads. Derived data: one JSON file per session, replaced by
// each candidates job, removed when there is no current model to rank by.
/** @import { Paths } from "../config/paths.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { SourcedItem } from "./fit-job.js" */
/** @import { App } from "./routing.js" */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PREFERENCE_STATE } from "../domain/preference-text.js";
import { rankCandidates } from "../domain/rank-candidates.js";
import { excerptTerms } from "../domain/training-set.js";
import { requireGenome } from "../engine/validate-genome.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import { findEmbedding } from "./embedding-store.js";
import { getGenome, listSessionCandidates } from "./generation-store.js";
import { predictScores } from "./predict-scores.js";
import { currentModel } from "./preference-summary.js";

/**
 * One excerpt's place. Two candidates of a session with the same genome and seed share an
 * excerpt, and so its place, as they share its A/B marks (0049).
 * @typedef {object} RankedExcerpt
 * @property {number} renderId
 * @property {number} score the posterior mean
 * @property {number} rank 1 for the highest score
 * @property {boolean} wildcard
 * @property {number} slot its place in the shown order, from 1
 */

/**
 * @typedef {object} SessionRanking
 * @property {number} sessionId
 * @property {string} modelKey the key of the model that scored it, which a rating stores
 * @property {RankedExcerpt[]} excerpts in the order the session made them
 * @property {number[][]} covariance of the excerpts' scores, in that order
 */

/**
 * @param {Paths} paths
 * @param {number} sessionId
 */
const rankingFile = (paths, sessionId) => join(paths.rankings, `${sessionId}.json`);

/**
 * @param {Paths} paths
 * @param {number} sessionId
 * @returns {Promise<SessionRanking | null>} null when the session isn't ranked
 */
export async function readRanking(paths, sessionId) {
  /** @type {string} */
  let text;
  try {
    text = await readFile(rankingFile(paths, sessionId), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text);
}

/**
 * What a candidates job reports of the ranking.
 * @typedef {object} RankResult
 * @property {number} ranked excerpts ranked; 0 when the session isn't ranked
 * @property {string | null} notRanked why not, or null when it is or the studio has never
 *   fitted a taste model, which is no change from before ranking existed
 */

/**
 * Ranks the session's excerpts under the brief's current model and writes the ranking, or
 * removes the session's ranking when there is no current model or it has no terms. The sidecar
 * is asked to predict only when the model file exists; a failure there throws.
 * @param {App} app
 * @param {{ id: number, vibeId: number }} session
 * @param {AbortSignal} signal
 * @param {() => void} [onPredict] called once, before the sidecar is asked to predict
 * @returns {Promise<RankResult>}
 */
export async function rankSession(app, session, signal, onPredict = () => undefined) {
  const file = rankingFile(app.paths, session.id);
  /** @param {string | null} why */
  const unranked = async (why) => {
    await rm(file, { force: true });
    return { ranked: 0, notRanked: why };
  };
  const found = await currentModel(app, session.vibeId, signal);
  if (found.state === PREFERENCE_STATE.none) return unranked(found.reason);
  if (found.state === PREFERENCE_STATE.stale) {
    return unranked(
      "the taste model is out of date since the last ratings, so the candidates aren't ranked; press Fit the taste model on the Model test page",
    );
  }
  const { producer, dimension } = found.embedder;

  /** @type {Map<number, SourcedItem>} each excerpt with a sound analysis, by render id */
  const items = new Map();
  for (const candidate of listSessionCandidates(app.store, session.id)) {
    const render = currentExcerpt(app.store, app.paths.renderCache, candidate);
    if (!render || items.has(render.id)) continue;
    const source = { ratedAudioId: null, renderId: render.id };
    if (!findEmbedding(app.store, source, producer)) continue;
    const row = getGenome(app.store, render.genomeId);
    if (!row) throw new Error(`render ${render.id} names genome ${render.genomeId}, which is gone`);
    const genome = requireGenome(row.genome, `genome ${render.genomeId} is invalid`);
    // Features are stored as extractFeatures returned them (decision 0023).
    const measured = /** @type {Features} */ (render.features);
    items.set(render.id, {
      source,
      ...excerptTerms(genome, measured, render.offset, render.duration),
    });
  }
  if (items.size === 0) {
    return unranked("no candidate of this session has its sound analyzed, so none is ranked");
  }

  /** @type {Awaited<ReturnType<typeof predictScores>>} */
  let scores;
  onPredict();
  try {
    scores = await predictScores(app, found.file, [...items.values()], {
      embeddingProducer: producer,
      dimension,
      signal,
    });
  } catch (error) {
    throw new Error(`ranking the candidates failed: ${/** @type {Error} */ (error).message}`, {
      cause: error,
    });
  }
  // A model with no terms, as one fitted on nothing usable is, scores every excerpt 0 with
  // variance 0 (decision 0045): it can't tell them apart, so it ranks nothing.
  if (scores.variance.every((v) => v === 0)) {
    return unranked("the taste model has nothing to tell the candidates apart by yet");
  }
  const { rank, wildcard, slot } = rankCandidates(scores.mean, session.id);
  /** @type {SessionRanking} */
  const ranking = {
    sessionId: session.id,
    modelKey: found.planned.key,
    excerpts: [...items.keys()].map((renderId, i) => ({
      renderId,
      score: /** @type {number} */ (scores.mean[i]),
      rank: /** @type {number} */ (rank[i]),
      wildcard: /** @type {boolean} */ (wildcard[i]),
      slot: /** @type {number} */ (slot[i]),
    })),
    covariance: scores.covariance,
  };
  // Through a temp file, so a reader never sees half of one.
  await mkdir(app.paths.rankings, { recursive: true });
  const temp = `${file}.partial`;
  await writeFile(temp, JSON.stringify(ranking));
  await rename(temp, file);
  return { ranked: items.size, notRanked: null };
}

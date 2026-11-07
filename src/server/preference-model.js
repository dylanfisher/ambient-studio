// Which preference models the store's ratings call for (decision 0044): one global model over
// every vibe and one per vibe whose prior is centered on it, each named by its model key
// (decision 0043) and kept as a file under the data root. A rating or thumbs whose excerpt has no
// embedding under the embedder's producer is left out and listed, as one with no features is.
/** @import { Paths } from "../config/paths.js" */
/** @import { Missing, TrainingSet } from "../domain/training-set.js" */
/** @import { Store } from "./store.js" */
import { join } from "node:path";
import { findEmbedding } from "./embedding-store.js";
import { modelKey } from "./model-key.js";
import { PRODUCER } from "./producer.js";
import { readTrainingSet } from "./read-training-set.js";
import { listVibes } from "./vibe-store.js";

/**
 * What every fit is given, in its key. Scales are prior standard deviations in logits:
 * `weightScale` of an item's score under the global prior, `vibeScale` of a vibe's score away
 * from the global one, `biasScale` of the left/right bias and `interceptScale` of the thumbs
 * intercept. Decision 0044 says why each value.
 */
export const HYPERPARAMETERS = Object.freeze({
  pcaDimension: 12,
  weightScale: 1.5,
  vibeScale: 1.5,
  biasScale: 1,
  interceptScale: 2,
  thumbsWeight: 1,
});

/**
 * One model to fit: its key, the set it is fitted on and the hyperparameters in its key.
 * @typedef {object} PlannedModel
 * @property {string} key
 * @property {TrainingSet} set the training set less what has no embedding
 * @property {Missing[]} unembedded a rating or thumbs left out because an excerpt it names has
 *   no embedding: one entry per such excerpt
 * @property {Record<string, unknown>} hyperparameters
 */

/**
 * @typedef {object} ModelPlan
 * @property {string} embeddingProducer
 * @property {PlannedModel} global over every vibe not removed
 * @property {(PlannedModel & { vibeId: number })[]} vibes oldest first
 */

/**
 * The model file for a key.
 * @param {Paths} paths
 * @param {string} key
 */
export const modelFile = (paths, key) => join(paths.models, `${key}.json`);

/**
 * The set less every pair and thumbs whose excerpt has no embedding.
 * @param {TrainingSet} set
 * @param {(ratedAudioId: number) => boolean} embedded
 * @returns {{ set: TrainingSet, unembedded: Missing[] }}
 */
function keepEmbedded(set, embedded) {
  /** @type {Missing[]} */
  const unembedded = [];
  const listed = new Set();
  /** @param {Missing} entry */
  const list = (entry) => {
    const name = JSON.stringify(entry);
    if (!listed.has(name)) unembedded.push(entry);
    listed.add(name);
  };
  const pairs = set.pairs.filter(({ ratingId, winner, loser }) => {
    // A tie's two halves name the same two excerpts, so `list` keeps one entry for each.
    for (const { ratedAudioId } of [winner, loser]) {
      if (!embedded(ratedAudioId)) list({ ratingId, ratedAudioId });
    }
    return embedded(winner.ratedAudioId) && embedded(loser.ratedAudioId);
  });
  const thumbs = set.thumbs.filter(({ feedbackId, item }) => {
    if (!embedded(item.ratedAudioId)) list({ feedbackId, ratedAudioId: item.ratedAudioId });
    return embedded(item.ratedAudioId);
  });
  return { set: { pairs, thumbs, missing: set.missing }, unembedded };
}

/**
 * The models the store's ratings call for under `embeddingProducer`.
 * @param {Store} store
 * @param {string} embeddingProducer
 * @returns {ModelPlan}
 */
export function modelPlan(store, embeddingProducer) {
  /** @param {number} ratedAudioId */
  const embedded = (ratedAudioId) =>
    findEmbedding(store, { ratedAudioId, renderId: null }, embeddingProducer) !== undefined;
  /** @param {TrainingSet} set @param {Record<string, unknown>} hyperparameters */
  const key = (set, hyperparameters) =>
    modelKey(set, { featureProducer: PRODUCER, embeddingProducer, hyperparameters });

  const kept = listVibes(store).map((vibe) => ({
    vibeId: vibe.id,
    ...keepEmbedded(readTrainingSet(store, vibe.id), embedded),
  }));
  /** @type {TrainingSet} */
  const union = {
    pairs: kept.flatMap(({ set }) => set.pairs),
    thumbs: kept.flatMap(({ set }) => set.thumbs),
    missing: kept.flatMap(({ set }) => set.missing),
  };
  const global = {
    key: key(union, HYPERPARAMETERS),
    set: union,
    unembedded: kept.flatMap(({ unembedded }) => unembedded),
    hyperparameters: HYPERPARAMETERS,
  };
  // The global key in each vibe's hyperparameters, since a vibe's prior and basis change when
  // any vibe's ratings do (decision 0043). Two vibes with no ratings share a key and a file:
  // both are the global prior.
  const vibes = kept.map(({ vibeId, set, unembedded }) => {
    const hyperparameters = { ...HYPERPARAMETERS, globalModel: global.key };
    return { vibeId, key: key(set, hyperparameters), set, unembedded, hyperparameters };
  });
  return { embeddingProducer, global, vibes };
}

// Which preference models the store's ratings call for (decision 0044): per vibe, a prior model
// fitted on every other vibe's ratings and the vibe's own model centered on it, each named by its
// model key (decision 0043) and kept as a file under the data root. A rating or thumbs whose
// excerpt has no embedding under the embedder's producer is left out and listed, as one with no
// features is. A fold leaves one session out of every set and of the basis.
/** @import { Paths } from "../config/paths.js" */
/** @import { Item, Missing, TrainingSet } from "../domain/training-set.js" */
/** @import { Store } from "./store.js" */
import { join } from "node:path";
import { findEmbedding } from "./embedding-store.js";
import { modelKey } from "./model-key.js";
import { PRODUCER } from "./producer.js";
import { readTrainingSet } from "./read-training-set.js";
import { listVibes } from "./vibe-store.js";

/**
 * What every fit is given, in its key, beside the model code. Scales are prior standard
 * deviations in logits: `weightScale` of an item's score under the base prior, `vibeScale` of a
 * vibe's score away from its prior model's, `biasScale` of the left/right bias and
 * `interceptScale` of the thumbs intercept. Decision 0044 says why each value.
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
 * A vibe's prior model: fitted on every other vibe's pairs and thumbs, with the basis computed
 * from `basisItems`, every excerpt in the plan's sets.
 * @typedef {PlannedModel & { basisItems: Item[] }} PlannedPrior
 */

/**
 * @typedef {object} ModelPlan
 * @property {string} embeddingProducer
 * @property {number | null} heldOutSession the session left out, for a fold
 * @property {(PlannedModel & { vibeId: number, prior: PlannedPrior })[]} vibes oldest first
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
 * The sets' pairs and thumbs together.
 * @param {TrainingSet[]} sets
 * @returns {TrainingSet}
 */
const union = (sets) => ({
  pairs: sets.flatMap((s) => s.pairs),
  thumbs: sets.flatMap((s) => s.thumbs),
  missing: sets.flatMap((s) => s.missing),
});

/**
 * Every excerpt the set names, once each, in the order first named.
 * @param {TrainingSet} set
 * @returns {Item[]}
 */
function itemsOf({ pairs, thumbs }) {
  /** @type {Map<number, Item>} */
  const items = new Map();
  for (const item of [...pairs.flatMap((p) => [p.winner, p.loser]), ...thumbs.map((t) => t.item)]) {
    if (!items.has(item.ratedAudioId)) items.set(item.ratedAudioId, item);
  }
  return [...items.values()];
}

/**
 * The models the store's ratings call for under `embeddingProducer`. With `heldOutSession`, that
 * session's pairs and thumbs are in no set, so none of its excerpts reach the basis either,
 * unless another session rated the same excerpt; 4e's folds use this.
 * @param {Store} store
 * @param {string} embeddingProducer
 * @param {{ modelCode: string, heldOutSession?: number | null }} options `modelCode` names the
 *   sidecar's preference code, from its `preference_code` method
 * @returns {ModelPlan}
 */
export function modelPlan(store, embeddingProducer, { modelCode, heldOutSession = null }) {
  /** @param {number} ratedAudioId */
  const embedded = (ratedAudioId) =>
    findEmbedding(store, { ratedAudioId, renderId: null }, embeddingProducer) !== undefined;
  /** @param {TrainingSet} set @param {Record<string, unknown>} hyperparameters */
  const key = (set, hyperparameters) =>
    modelKey(set, { featureProducer: PRODUCER, embeddingProducer, hyperparameters });
  /** @param {{ sessionId: number }} row */
  const kept = (row) => row.sessionId !== heldOutSession;
  const base = { ...HYPERPARAMETERS, modelCode };

  const vibes = listVibes(store).map((vibe) => {
    const read = readTrainingSet(store, vibe.id);
    const fold = { ...read, pairs: read.pairs.filter(kept), thumbs: read.thumbs.filter(kept) };
    return { vibeId: vibe.id, ...keepEmbedded(fold, embedded) };
  });
  const everything = union(vibes.map((v) => v.set));
  // The basis is every vibe's excerpts, so each prior's key names every set's ratings through
  // `basis`, not only the other vibes' its pairs come from.
  const basis = key(everything, base);
  const basisItems = itemsOf(everything);
  return {
    embeddingProducer,
    heldOutSession,
    vibes: vibes.map(({ vibeId, set, unembedded }) => {
      const others = vibes.filter((v) => v.vibeId !== vibeId);
      const priorSet = union(others.map((v) => v.set));
      const priorHyperparameters = { ...base, basis };
      const prior = {
        key: key(priorSet, priorHyperparameters),
        set: priorSet,
        unembedded: others.flatMap((v) => v.unembedded),
        hyperparameters: priorHyperparameters,
        basisItems,
      };
      // The prior's key in the vibe's, since the vibe's prior and basis change when any
      // vibe's ratings do (decision 0043). Identical inputs share a key and a file.
      const hyperparameters = { ...base, globalModel: prior.key };
      return { vibeId, key: key(set, hyperparameters), set, unembedded, hyperparameters, prior };
    }),
  };
}

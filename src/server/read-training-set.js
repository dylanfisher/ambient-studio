// A vibe's training set from the store (decision 0043): its live ratings and feedback, the
// genomes they name, and the features of each rated audio from its render under this server's
// producer.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { TrainingSet } from "../domain/training-set.js" */
/** @import { HeardExcerpt } from "./rating-store.js" */
/** @import { Store } from "./store.js" */
import { buildTrainingSet } from "../domain/training-set.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { getGenome } from "./generation-store.js";
import { PRODUCER } from "./producer.js";
import { listFeedback, listRatedAudio, listRatings } from "./rating-store.js";
import { findRender } from "./render-store.js";

/**
 * Rated audio heard under another engine has no features here: its render under this producer
 * is of other samples than the owner heard, so the set reports it as missing.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {TrainingSet}
 */
export function readTrainingSet(store, vibeId) {
  const ratings = listRatings(store, vibeId);
  const feedback = listFeedback(store, vibeId);
  /** @type {(HeardExcerpt & { ratedAudioId: number })[]} */
  const heard = [...ratings.flatMap((r) => [r.a, r.b]), ...feedback];
  const targets = new Map(listRatedAudio(store).map((row) => [row.id, row.target]));

  /** @type {Map<number, unknown>} */
  const genomes = new Map();
  /** @type {Map<number, Features>} */
  const features = new Map();
  for (const { ratedAudioId, genomeId, seed, offset, duration, engineVersion } of heard) {
    if (!genomes.has(genomeId)) {
      const row = getGenome(store, genomeId);
      if (!row)
        throw new Error(`rated audio ${ratedAudioId} names genome ${genomeId}, which is gone`);
      genomes.set(genomeId, row.genome);
    }
    if (features.has(ratedAudioId) || engineVersion !== ENGINE_VERSION) continue;
    const target = targets.get(ratedAudioId);
    if (target === undefined) throw new Error(`there is no rated audio ${ratedAudioId}`);
    const render = findRender(store, {
      genomeId,
      seed,
      offset,
      duration,
      target,
      producer: PRODUCER,
    });
    // Features are stored as extractFeatures returned them (decision 0023).
    if (render) features.set(ratedAudioId, /** @type {Features} */ (render.features));
  }
  return buildTrainingSet({ ratings, feedback, genomes, features });
}

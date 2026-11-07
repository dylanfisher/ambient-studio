// The one text form of what a preference model is fitted from, which src/server hashes into the
// model key (decision 0043), as it hashes a genome's canonical text (decision 0005).
/** @import { TrainingSet } from "./training-set.js" */
import { sortedJson } from "../engine/canonical-genome.js";
import { isObject } from "../engine/is-object.js";

/**
 * @typedef {object} ModelTerms
 * @property {string} featureProducer the renders' `producer`, naming the engine and the
 *   feature extractor
 * @property {string | null} embeddingProducer the embedding checkpoint's producer; null for a
 *   fit that reads no embeddings
 * @property {Record<string, unknown>} hyperparameters as the fit is given them
 */

/**
 * Canonical JSON of the set's rating and thumbs ids, sorted, and the terms. Row order doesn't
 * change it; a row added, removed or left out for missing features does. The set's values aren't
 * written: the ids and the producers fix them.
 * @param {TrainingSet} set
 * @param {ModelTerms} terms
 * @returns {string}
 */
export function modelKeyText(
  { pairs, thumbs },
  { featureProducer, embeddingProducer, hyperparameters },
) {
  if (typeof featureProducer !== "string" || featureProducer === "") {
    throw new Error(
      `the feature producer must be a non-empty string; got ${JSON.stringify(featureProducer)}`,
    );
  }
  if (
    embeddingProducer !== null &&
    (typeof embeddingProducer !== "string" || embeddingProducer === "")
  ) {
    throw new Error(
      `the embedding producer must be a string, or null for a fit without embeddings; got ${String(JSON.stringify(embeddingProducer))}`,
    );
  }
  if (!isObject(hyperparameters)) {
    throw new Error(
      `the hyperparameters must be an object; got ${String(JSON.stringify(hyperparameters))}`,
    );
  }
  const ascending = (/** @type {number[]} */ ids) => [...new Set(ids)].sort((x, y) => x - y);
  return sortedJson({
    ratingIds: ascending(pairs.map((p) => p.ratingId)),
    thumbsIds: ascending(thumbs.map((t) => t.feedbackId)),
    featureProducer,
    embeddingProducer,
    hyperparameters,
  });
}

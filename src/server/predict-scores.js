// Scores excerpts under a fitted preference model through the sidecar's `predict` (decision
// 0044): each item's mean score and variance, and the covariance of every two. The items file is
// written to a temp folder under the data root and removed afterwards.
/** @import { Item } from "../domain/training-set.js" */
/** @import { SourcedItem } from "./fit-job.js" */
/** @import { App } from "./routing.js" */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fitInput } from "./fit-job.js";

/**
 * @typedef {object} Scores
 * @property {number[]} mean each item's score, in the order given
 * @property {number[]} variance
 * @property {number[][]} covariance of every two items' scores, the variances on its diagonal
 */

/**
 * Whether `value` is `length` finite numbers.
 * @param {unknown} value
 * @param {number} length
 */
const numbers = (value, length) =>
  Array.isArray(value) && value.length === length && value.every((x) => Number.isFinite(x));

/**
 * @param {App} app
 * @param {string} model the model file
 * @param {(Item | SourcedItem)[]} items distinct excerpts, each with an embedding under
 *   `embeddingProducer`
 * @param {{ embeddingProducer: string, dimension: number, signal: AbortSignal }} options
 * @returns {Promise<Scores>}
 */
export async function predictScores(app, model, items, { embeddingProducer, dimension, signal }) {
  const temp = await mkdtemp(join(app.config.dataRoot, ".predict-"));
  try {
    const embeddingsPath = join(temp, "items.f32");
    // A fit's input with no pairs lists the basis items in order, each with its embedding row,
    // which is what `predict` reads.
    const { set, embeddings } = fitInput(
      app.store,
      { pairs: [], thumbs: [], missing: [] },
      {
        embeddingProducer,
        dimension,
        hyperparameters: {},
        prior: null,
        embeddingsPath,
        basisItems: items,
      },
    );
    const { featureNames, macroNames, embeddingDimension } = set;
    const itemsPath = join(temp, "items.json");
    await writeFile(embeddingsPath, embeddings);
    await writeFile(
      itemsPath,
      JSON.stringify({
        featureNames,
        macroNames,
        embeddingDimension,
        embeddings: embeddingsPath,
        items: set.items,
      }),
    );
    const out = join(temp, "scores.json");
    await app.sidecar.request("predict", { model, items: itemsPath, out }, { signal });
    const { mean, variance, covariance } = JSON.parse(await readFile(out, "utf8"));
    const n = items.length;
    if (
      !numbers(mean, n) ||
      !numbers(variance, n) ||
      !Array.isArray(covariance) ||
      covariance.length !== n ||
      !covariance.every((row) => numbers(row, n))
    ) {
      throw new Error(`predict wrote scores for other than the ${n} items it was given`);
    }
    return { mean, variance, covariance };
  } finally {
    await rm(temp, { recursive: true });
  }
}

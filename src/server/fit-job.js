// The owner-started fit job (decision 0044): fits the global preference model over every vibe,
// then each vibe's model with its prior centered on the global one, through the sidecar's `fit`.
// A model whose file is already there under its key is kept rather than fitted again. Nothing
// else starts it.
/** @import { Item, TrainingSet } from "../domain/training-set.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { PlannedModel } from "./preference-model.js" */
/** @import { App } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FEATURE_NAMES } from "../domain/feature-names.js";
import { MACROS } from "../engine/genome-schema.js";
import { readEmbedder } from "./embed-audio.js";
import { findEmbedding } from "./embedding-store.js";
import { JOB_STEP } from "./job-steps.js";
import { modelFile, modelPlan } from "./preference-model.js";

/** Bytes per float32 in an embedding row. */
const FLOAT_BYTES = 4;

/**
 * What the sidecar's `fit` reads: the set's distinct excerpts as items, the pairs and thumbs by
 * item index, and the item's embeddings as rows of the `embeddings` bytes, in item order.
 * @typedef {object} FitInput
 * @property {Record<string, unknown>} set the JSON the sidecar reads
 * @property {Uint8Array} embeddings little-endian float32, one row per item
 */

/**
 * @param {Store} store
 * @param {TrainingSet} set
 * @param {object} options
 * @param {string} options.embeddingProducer
 * @param {number} options.dimension floats per embedding
 * @param {Record<string, unknown>} options.hyperparameters
 * @param {string | null} options.prior the global model's file, or null for the global fit
 * @param {string} options.embeddingsPath where `embeddings` will be written, absolute
 * @returns {FitInput}
 */
export function fitInput(
  store,
  { pairs, thumbs },
  { embeddingProducer, dimension, hyperparameters, prior, embeddingsPath },
) {
  const macroNames = Object.keys(MACROS);
  /** @type {Map<number, number>} rated audio id to item index */
  const indices = new Map();
  /** @type {Record<string, unknown>[]} */
  const items = [];
  /** @type {Uint8Array[]} */
  const rows = [];
  /** @param {Item} item */
  const index = (item) => {
    const known = indices.get(item.ratedAudioId);
    if (known !== undefined) return known;
    const source = { ratedAudioId: item.ratedAudioId, renderId: null };
    const vector = findEmbedding(store, source, embeddingProducer)?.vector;
    if (vector?.length !== dimension * FLOAT_BYTES) {
      throw new Error(
        `rated audio ${item.ratedAudioId} has ${vector ? `${vector.length} bytes of embedding, not ${dimension} floats` : "no embedding"}`,
      );
    }
    indices.set(item.ratedAudioId, items.length);
    rows.push(vector);
    items.push({
      features: FEATURE_NAMES.map(({ name }) => item.features[name] ?? null),
      macros: macroNames.map((name) => /** @type {Record<string, number>} */ (item.macros)[name]),
    });
    return items.length - 1;
  };
  const set = {
    hyperparameters,
    featureNames: FEATURE_NAMES.map(({ name }) => name),
    macroNames,
    embeddingDimension: dimension,
    embeddings: embeddingsPath,
    prior,
    pairs: pairs.map(({ winner, loser, weight, winnerLeft }) => ({
      winner: index(winner),
      loser: index(loser),
      weight,
      winnerLeft,
    })),
    thumbs: thumbs.map(({ item, up }) => ({ item: index(item), up })),
    items,
  };
  const embeddings = new Uint8Array(rows.length * dimension * FLOAT_BYTES);
  for (const [i, row] of rows.entries()) embeddings.set(row, i * dimension * FLOAT_BYTES);
  return { set, embeddings };
}

/**
 * What a fitted or kept model was fitted on.
 * @typedef {object} FittedModel
 * @property {string} key
 * @property {boolean} kept its file was there under its key, so it wasn't fitted again
 * @property {number} ratings A/B ratings, a tie counted once
 * @property {number} ties
 * @property {number} thumbs
 * @property {number} unembedded excerpts left out for having no embedding
 * @property {number} missing excerpts left out for having no features
 * @property {string} summary what it was fitted on, in plain words
 */

/** @typedef {FittedModel & { vibeId: number }} VibeModel */

/**
 * @typedef {object} FitJobResult
 * @property {string} embeddingProducer
 * @property {FittedModel} global
 * @property {VibeModel[]} vibes
 */

/**
 * What a model was fitted on, for the owner. A vibe with no ratings says it is the global
 * prior; with thumbs alone, that the left/right bias stays at its prior.
 * @param {PlannedModel} planned
 * @param {boolean} vibe
 * @returns {Omit<FittedModel, "key" | "kept">}
 */
function fittedOn({ set, unembedded }, vibe) {
  const ratings = new Set(set.pairs.map((p) => p.ratingId)).size;
  const ties = new Set(set.pairs.filter((p) => p.tie).map((p) => p.ratingId)).size;
  const thumbs = set.thumbs.length;
  const missing = set.missing.length;
  /** @type {string[]} */
  const parts = [];
  if (ratings === 0 && thumbs === 0) {
    parts.push(
      vibe
        ? "No ratings to fit, so it predicts from the model over every brief"
        : "No ratings to fit in any brief, so it predicts from its prior alone",
    );
  } else {
    const tieText = ties > 0 ? ` (${ties} of them about the same)` : "";
    parts.push(`Fitted on ${ratings} A/B choices${tieText} and ${thumbs} thumbs`);
    if (ratings === 0) parts.push("with no A/B choices, the left/right lean stays at its prior");
  }
  if (unembedded.length > 0) {
    parts.push(
      `${unembedded.length} rated excerpts left out because their sound isn't analyzed yet; run the embed job`,
    );
  }
  if (missing > 0) {
    parts.push(
      `${missing} rated excerpts left out because they have no features under this engine`,
    );
  }
  return {
    ratings,
    ties,
    thumbs,
    unembedded: unembedded.length,
    missing,
    summary: `${parts.join("; ")}.`,
  };
}

/**
 * The job. Each model is written to a temp folder under the data root and moved to its file
 * once the sidecar has fitted it, so a failed fit leaves no file under its key.
 * @param {App} app
 * @returns {(job: JobContext) => Promise<FitJobResult>}
 */
export function fitJob(app) {
  return async ({ signal, progress }) => {
    progress(0, 0, JOB_STEP.fittingCheck);
    const embedder = await readEmbedder(app, { fetch: false, signal });
    if (typeof embedder === "string") {
      throw new Error(`the taste model reads each rated excerpt's sound analysis, and ${embedder}`);
    }
    const { producer, dimension } = embedder;
    const plan = modelPlan(app.store, producer);
    const total = 1 + plan.vibes.length;

    /**
     * @param {PlannedModel} planned
     * @param {string | null} prior
     * @param {string} what names the model in an error
     * @returns {Promise<boolean>} whether the file was already there
     */
    async function fitModel(planned, prior, what) {
      const file = modelFile(app.paths, planned.key);
      if (existsSync(file)) return true;
      const temp = await mkdtemp(join(app.config.dataRoot, ".fit-"));
      try {
        const embeddingsPath = join(temp, "embeddings.f32");
        const { set, embeddings } = fitInput(app.store, planned.set, {
          embeddingProducer: producer,
          dimension,
          hyperparameters: planned.hyperparameters,
          prior,
          embeddingsPath,
        });
        const setPath = join(temp, "set.json");
        await writeFile(embeddingsPath, embeddings);
        await writeFile(setPath, JSON.stringify(set));
        const out = join(temp, "model.json");
        try {
          await app.sidecar.request("fit", { set: setPath, out }, { signal });
        } catch (error) {
          throw new Error(`fitting ${what} failed: ${/** @type {Error} */ (error).message}`, {
            cause: error,
          });
        }
        await mkdir(app.paths.models, { recursive: true });
        await rename(out, file);
        return false;
      } finally {
        await rm(temp, { recursive: true });
      }
    }

    progress(0, total, JOB_STEP.fittingGlobal);
    const globalKept = await fitModel(plan.global, null, "the model over every brief");
    const globalFile = modelFile(app.paths, plan.global.key);
    /** @type {VibeModel[]} */
    const vibes = [];
    for (const [index, planned] of plan.vibes.entries()) {
      signal.throwIfAborted();
      progress(index + 1, total, JOB_STEP.fittingVibe(index + 1, plan.vibes.length));
      const kept = await fitModel(planned, globalFile, `brief ${planned.vibeId}`);
      vibes.push({ vibeId: planned.vibeId, key: planned.key, kept, ...fittedOn(planned, true) });
    }
    progress(total, total, null);
    return {
      embeddingProducer: producer,
      global: { key: plan.global.key, kept: globalKept, ...fittedOn(plan.global, false) },
      vibes,
    };
  };
}

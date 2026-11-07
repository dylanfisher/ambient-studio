// The owner-started fit job (decision 0044): for each vibe, fits a prior model on every other
// vibe's ratings, then the vibe's own model centered on it, through the sidecar's `fit`. A model
// whose file is already there under its key is kept rather than fitted again. Nothing else
// starts it.
/** @import { Item, TrainingSet } from "../domain/training-set.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { ModelPlan, PlannedModel } from "./preference-model.js" */
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
 * What the sidecar's `fit` reads: the distinct excerpts as items, the pairs and thumbs by item
 * index, and the items' embeddings as rows of the `embeddings` bytes, in item order.
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
 * @param {string | null} options.prior the prior model's file, or null for a prior's own fit
 * @param {string} options.embeddingsPath where `embeddings` will be written, absolute
 * @param {Item[]} [options.basisItems] excerpts listed first, for a prior's fit, which computes
 *   the basis from every item in its file
 * @returns {FitInput}
 */
export function fitInput(
  store,
  { pairs, thumbs },
  { embeddingProducer, dimension, hyperparameters, prior, embeddingsPath, basisItems = [] },
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
  for (const item of basisItems) index(item);
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
 * What a vibe's model was fitted on, and its prior.
 * @typedef {object} VibeModel
 * @property {number} vibeId
 * @property {string} key
 * @property {boolean} kept its file was there under its key, so it wasn't fitted again
 * @property {string} priorKey the prior model's key, fitted on every other vibe's ratings
 * @property {boolean} priorKept
 * @property {number} ratings A/B ratings, a tie counted once
 * @property {number} ties
 * @property {number} thumbs
 * @property {number} priorRatings the other vibes' A/B ratings
 * @property {number} priorThumbs
 * @property {number} unembedded distinct excerpts left out for having no embedding
 * @property {number} missing distinct excerpts left out for having no features
 * @property {string} summary what it was fitted on, in plain words
 */

/**
 * @typedef {object} FitJobResult
 * @property {string} embeddingProducer
 * @property {VibeModel[]} vibes
 */

/**
 * The A/B ratings, ties, thumbs and distinct excerpts left out of a planned model.
 * @param {PlannedModel} planned
 */
function counts({ set, unembedded }) {
  /** @param {{ ratedAudioId: number }[]} entries */
  const excerpts = (entries) => new Set(entries.map((e) => e.ratedAudioId)).size;
  return {
    ratings: new Set(set.pairs.map((p) => p.ratingId)).size,
    ties: new Set(set.pairs.filter((p) => p.tie).map((p) => p.ratingId)).size,
    thumbs: set.thumbs.length,
    unembedded: excerpts(unembedded),
    missing: excerpts(set.missing),
  };
}

/**
 * What a vibe's model was fitted on, for the owner. With no ratings it says what it predicts
 * from; with thumbs alone, that the left/right bias stays at its prior; with no other vibe's
 * ratings, that its prior is the base prior.
 * @param {PlannedModel} vibe
 * @param {PlannedModel} prior
 */
function fittedOn(vibe, prior) {
  const own = counts(vibe);
  const theirs = counts(prior);
  const priorEmpty = theirs.ratings === 0 && theirs.thumbs === 0;
  /** @type {string[]} */
  const parts = [];
  if (own.ratings === 0 && own.thumbs === 0) {
    parts.push(
      priorEmpty
        ? "No ratings to fit, and no other brief has any, so it predicts from the base prior alone"
        : "No ratings to fit, so it predicts from the model over the other briefs",
    );
  } else {
    const tieText = own.ties > 0 ? ` (${own.ties} of them about the same)` : "";
    parts.push(`Fitted on ${own.ratings} A/B choices${tieText} and ${own.thumbs} thumbs`);
    if (own.ratings === 0) {
      parts.push("with no A/B choices, the left/right lean stays at its prior");
    }
    if (priorEmpty) parts.push("no other brief has ratings, so it starts from the base prior");
  }
  if (own.unembedded > 0) {
    parts.push(
      `${own.unembedded} rated excerpts left out because their sound isn't analyzed yet; run the embed job`,
    );
  }
  if (own.missing > 0) {
    parts.push(
      `${own.missing} rated excerpts left out because they have no features under this engine`,
    );
  }
  return {
    ...own,
    priorRatings: theirs.ratings,
    priorThumbs: theirs.thumbs,
    summary: `${parts.join("; ")}.`,
  };
}

/**
 * The sidecar's preference code, which every model key names.
 * @param {App} app
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
export async function readModelCode(app, signal) {
  const { code } = await app.sidecar.request("preference_code", {}, { signal });
  return /** @type {string} */ (code);
}

/**
 * Fits every model in the plan whose file is missing: each vibe's prior, then the vibe. Each is
 * written to a temp folder under the data root and moved to its file once the sidecar has fitted
 * it, so a failed or cancelled fit leaves no file under its key. 4e's folds call it with a plan
 * that holds one session out.
 * @param {App} app
 * @param {ModelPlan} plan
 * @param {object} options
 * @param {number} options.dimension floats per embedding
 * @param {AbortSignal} options.signal
 * @param {(n: number, of: number) => void} options.onVibe called before each vibe's fits
 * @returns {Promise<VibeModel[]>}
 */
export async function fitModels(app, plan, { dimension, signal, onVibe }) {
  /**
   * @param {PlannedModel} planned
   * @param {{ prior: string | null, basisItems?: Item[] }} input
   * @param {string} what names the model in an error
   * @returns {Promise<boolean>} whether the file was already there
   */
  async function fitModel(planned, input, what) {
    const file = modelFile(app.paths, planned.key);
    if (existsSync(file)) return true;
    const temp = await mkdtemp(join(app.config.dataRoot, ".fit-"));
    try {
      const embeddingsPath = join(temp, "embeddings.f32");
      const { set, embeddings } = fitInput(app.store, planned.set, {
        embeddingProducer: plan.embeddingProducer,
        dimension,
        hyperparameters: planned.hyperparameters,
        embeddingsPath,
        ...input,
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

  /** @type {VibeModel[]} */
  const fitted = [];
  for (const [index, planned] of plan.vibes.entries()) {
    signal.throwIfAborted();
    onVibe(index + 1, plan.vibes.length);
    const { prior } = planned;
    const what = `brief ${planned.vibeId}`;
    const priorKept = await fitModel(
      prior,
      { prior: null, basisItems: prior.basisItems },
      `the prior for ${what}`,
    );
    const kept = await fitModel(planned, { prior: modelFile(app.paths, prior.key) }, what);
    fitted.push({
      vibeId: planned.vibeId,
      key: planned.key,
      kept,
      priorKey: prior.key,
      priorKept,
      ...fittedOn(planned, prior),
    });
  }
  return fitted;
}

/**
 * The job.
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
    const modelCode = await readModelCode(app, signal);
    const plan = modelPlan(app.store, producer, { modelCode });
    const total = plan.vibes.length;
    const vibes = await fitModels(app, plan, {
      dimension,
      signal,
      onVibe: (n, of) => progress(n - 1, total, JOB_STEP.fittingVibe(n, of)),
    });
    progress(total, total, null);
    return { embeddingProducer: producer, vibes };
  };
}

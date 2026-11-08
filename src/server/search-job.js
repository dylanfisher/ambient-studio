// The model-in-the-loop search job (decision 0054): CMA-ES in the sidecar from a base candidate's
// position, every point stored as a session candidate, each that passes rendered, embedded and
// scored by the brief's taste model (`searchScore`), and nothing sent to omlx. The session shows
// the run's best few apart in sound, the rest folded under them. With the control switch on, as
// many medium nudges of the base follow, scored the same way and stored outside any session. It
// runs only when the owner's request adds it to the job runner.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { StepSeconds } from "../domain/search-cost.js" */
/** @import { Lock } from "../domain/validate-lock.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { CurrentModel } from "./preference-summary.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { App } from "./routing.js" */
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { applyLocks } from "../domain/apply-locks.js";
import { lockRefusal, nudge } from "../domain/nudge.js";
import { OPERATOR } from "../domain/operator.js";
import { PREFERENCE_STATE } from "../domain/preference-text.js";
import { BENCH_SECONDS, medianTimings } from "../domain/search-cost.js";
import { searchScore } from "../domain/search-score.js";
import {
  SEARCH_OPTIMIZER,
  SEARCH_SIGMA,
  SEARCH_STEP_SIZE,
  searchPopulation,
} from "../domain/search-settings.js";
import { MIN_SHOWN_DISTANCE, shownPoints } from "../domain/search-shown.js";
import { searchSpace } from "../domain/search-space.js";
import { excerptTerms } from "../domain/training-set.js";
import { canonicalGenome } from "../engine/canonical-genome.js";
import { requireGenome } from "../engine/validate-genome.js";
import { toVector } from "../engine/vector-view.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { jobRecordings, STREAM_SEEDS } from "./candidate-job.js";
import { embedAudio } from "./embed-audio.js";
import { findEmbedding } from "./embedding-store.js";
import { currentRevision, keep } from "./generate-candidates.js";
import { getGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { locksInForce } from "./lock-store.js";
import { verdictOf } from "./nudge-job.js";
import { predictScores } from "./predict-scores.js";
import { currentModel } from "./preference-summary.js";
import { renderExcerpt } from "./render-excerpt.js";
import {
  nextRun,
  numberedRuns,
  searchGeneration,
  searchRunFolder,
  startSearch,
} from "./search-run.js";
import { rankSession } from "./session-ranking.js";

/** The source every point and control child stores. */
const SOURCE = "optimizer";
/** Each run's summary, written after every generation, so a cancel keeps what was scored. */
const RESULTS = "results.json";

/**
 * @typedef {object} SearchRequest
 * @property {number} vibeId
 * @property {number} sessionId
 * @property {Candidate} base
 * @property {Genome} genome the base's
 * @property {number} budget points the search asks for, rejected ones included
 * @property {readonly string[]} raw the owner's chosen raw paths; none by default
 * @property {boolean} control whether the control arm runs after the search
 */

/**
 * One scored excerpt.
 * @typedef {object} Evaluation
 * @property {number} score its `searchScore`
 * @property {Float32Array} embedding its excerpt's CLAP embedding
 * @property {StepSeconds} seconds what its render and embed took
 */

/**
 * Renders, embeds and scores candidates that passed, in order.
 * @typedef {(candidates: Candidate[], signal: AbortSignal) => Promise<Evaluation[]>} Scorer
 */

/**
 * Makes the job's scorer when it starts, or throws why it can't.
 * @typedef {(app: App, context: { vibeId: number, recordings: readonly RecordingEntry[],
 *   signal: AbortSignal }) => Promise<Scorer>} ScorerFactory
 */

/**
 * @typedef {object} ScoredCandidate
 * @property {number} candidateId
 * @property {number} score
 */

/**
 * A run's summary in its folder. Derived data: nothing reads it once the run's rows are gone.
 * @typedef {object} SearchResults
 * @property {string[]} paths the space's dimensions
 * @property {number} baseId
 * @property {ScoredCandidate[]} evaluated each scored point, in the order evaluated
 * @property {number[]} shown the points the session shows, best first
 * @property {Record<string, number>} foldedUnder each other scored point's id, with the shown
 *   point it folds under
 * @property {number} distance the least CLAP cosine distance between two shown points
 * @property {StepSeconds[]} timings one per scored point, search and control alike
 * @property {{ evaluated: ScoredCandidate[] } | null} control the control arm's, or null when
 *   it didn't run
 */

/**
 * Why the brief's current model can't score a search, or null when it can. The search route
 * refuses with this, and the job fails with it when the model went between the two.
 * @param {CurrentModel} found
 * @returns {string | null}
 */
export function searchRefusal(found) {
  if (found.state === PREFERENCE_STATE.fitted) return null;
  if (found.state === PREFERENCE_STATE.stale) {
    return "The taste model is out of date since the last ratings, so a search would score by old taste. Press Fit the taste model on the Model test page first.";
  }
  if (found.reason !== null) {
    return `A search scores its points by the taste model, which can't be read: ${found.reason}`;
  }
  return "This brief has no taste model yet, so a search has nothing to score its points by. Rate some pairs in A/B, then press Fit the taste model on the Model test page.";
}

/**
 * The scorer of every real search: render the excerpt, embed it unless it has a row under the
 * current embedder, then one `predict` for the batch under the brief's current model.
 * @type {ScorerFactory}
 */
async function modelScorer(app, { vibeId, recordings, signal }) {
  const found = await currentModel(app, vibeId, signal);
  const refused = searchRefusal(found);
  if (refused !== null || found.state !== PREFERENCE_STATE.fitted) throw new Error(refused ?? "");
  const { embedder, file: model } = found;
  return async (candidates, signal) => {
    /** @type {{ embedding: Float32Array, seconds: StepSeconds }[]} */
    const made = [];
    const items = [];
    for (const candidate of candidates) {
      signal.throwIfAborted();
      // A candidate that passed has a genome row, so it has an excerpt to render.
      const request = /** @type {ExcerptRequest} */ (excerptRequest(app.store, candidate));
      const started = performance.now();
      const { render } = await renderExcerpt(app.store, app.paths.renderCache, request, recordings);
      const rendered = performance.now();
      signal.throwIfAborted();
      const source = { ratedAudioId: null, renderId: render.id };
      const row =
        findEmbedding(app.store, source, embedder.producer) ??
        (await embedAudio(app, embedder, source, join(app.paths.renderCache, render.file), signal));
      const embedded = performance.now();
      const genome = requireGenome(
        getGenome(app.store, request.genomeId)?.genome,
        `genome ${request.genomeId} is invalid`,
      );
      // Features are stored as extractFeatures returned them (decision 0023).
      const measured = /** @type {any} */ (render.features);
      items.push({ source, ...excerptTerms(genome, measured, render.offset, render.duration) });
      made.push({
        embedding: new Float32Array(row.vector.slice().buffer),
        seconds: { render: (rendered - started) / 1000, embed: (embedded - rendered) / 1000 },
      });
    }
    const { mean, variance } = await predictScores(app, model, items, {
      embeddingProducer: embedder.producer,
      dimension: embedder.dimension,
      signal,
    });
    return made.map((each, i) => ({
      ...each,
      score: searchScore(/** @type {number} */ (mean[i]), /** @type {number} */ (variance[i])),
    }));
  };
}

/**
 * Writes the run's summary through a temp file, so a reader never sees half of one.
 * @param {string} folder
 * @param {SearchResults} results
 */
async function writeResults(folder, results) {
  const file = join(folder, RESULTS);
  await writeFile(`${file}.partial`, JSON.stringify(results));
  await rename(`${file}.partial`, file);
}

/**
 * A run's summary, or null when the run has none yet.
 * @param {string} dataRoot
 * @param {string} run
 * @returns {Promise<SearchResults | null>}
 */
export async function readSearchResults(dataRoot, run) {
  try {
    return JSON.parse(await readFile(join(searchRunFolder(dataRoot, run), RESULTS), "utf8"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * What the confirm's estimate reads: the medians of the newest run that scored a point, or the
 * bench before any.
 * @param {string} dataRoot
 * @returns {Promise<{ seconds: StepSeconds, measured: boolean }>}
 */
export async function searchEstimate(dataRoot) {
  for (const run of (await numberedRuns(dataRoot)).reverse()) {
    const timings = (await readSearchResults(dataRoot, run))?.timings ?? [];
    if (timings.length > 0) return { seconds: medianTimings(timings), measured: true };
  }
  return { seconds: BENCH_SECONDS, measured: false };
}

/** @param {readonly ScoredCandidate[]} scored the best, the first of a tie */
const bestOf = (scored) =>
  scored.reduce(
    (/** @type {ScoredCandidate | null} */ best, each) =>
      best === null || each.score > best.score ? each : best,
    null,
  );

/**
 * The job that searches from `base` under the vibe's current revision and live locks, read when
 * it starts. Progress counts points asked, reported once per generation. A cancel stops the job
 * at the next step it checks, with every row stored before it kept, and the summary as of the
 * last generation scored.
 * @param {App} app
 * @param {SearchRequest} request
 * @param {{ makeScorer?: ScorerFactory }} [options] the model's scorer when omitted; tests
 *   script one
 * @returns {(job: JobContext) => Promise<unknown>}
 */
export function searchJob(app, request, { makeScorer = modelScorer } = {}) {
  const { vibeId, sessionId, base, genome, budget, raw, control } = request;
  return async (job) => {
    const recordings = await jobRecordings(app);
    job.signal.throwIfAborted();
    const { revision, constraints } = currentRevision(app.store, vibeId);
    const locks = locksInForce(app.store, vibeId);
    const applied = applyLocks(genome, locks);
    const refused = lockRefusal(applied);
    if (refused !== null) throw new Error(`candidate ${base.id} ${refused}`);
    const start = applied.genome;
    const paths = searchSpace(start, locks, constraints, raw);
    if (paths.length === 0) {
      throw new Error("every macro is locked or fixed by the brief and no path was chosen");
    }
    const score = await makeScorer(app, { vibeId, recordings, signal: job.signal });
    const seed = Math.floor(app.random() * STREAM_SEEDS);
    const population = searchPopulation(paths.length);
    const run = await nextRun(app.config.dataRoot);
    const spec = {
      optimizer: SEARCH_OPTIMIZER,
      start: toVector(start, paths),
      seed,
      settings: { sigma: SEARCH_SIGMA, population },
    };
    const folder = await startSearch(app, run, spec, { signal: job.signal });
    const batch = { store: app.store, vibeId, vibeRevisionId: revision.id, sessionId, locks };
    // A point keeps the base's seed, so it differs from the base only in its genome.
    const origin = {
      seed: base.seed,
      source: SOURCE,
      parentIds: [base.id],
      operator: OPERATOR.optimize,
      operatorParams: { run, seed, budget, population, paths },
    };
    const context = {
      locks,
      constraints,
      seen: new Map([[canonicalGenome(start), `candidate ${base.id}, the base`]]),
    };
    const total = control ? 2 * budget : budget;
    /** @type {SearchResults} */
    const results = {
      paths,
      baseId: base.id,
      evaluated: [],
      shown: [],
      foldedUnder: {},
      distance: MIN_SHOWN_DISTANCE,
      timings: [],
      control: null,
    };
    /** @type {{ id: number, score: number, embedding: Float32Array }[]} */
    const scored = [];
    /** @type {number[]} */
    const candidateIds = [];
    const generations = Math.ceil(budget / population);
    let asked = 0;
    for (let generation = 0; asked < budget; generation++) {
      const count = Math.min(population, budget - asked);
      job.progress(asked, total, JOB_STEP.searching(generation + 1, generations));
      /** @type {Evaluation[]} */
      let evaluations = [];
      const { candidates, scores } = await searchGeneration(app, folder, {
        generation,
        count,
        start,
        paths,
        context,
        batch,
        origin,
        evaluate: async (valid, signal) => {
          evaluations = await score(valid, signal);
          return evaluations.map((each) => each.score);
        },
        signal: job.signal,
      });
      candidateIds.push(...candidates.map(({ id }) => id));
      const valid = candidates.filter((_, i) => scores[i] !== null);
      for (const [i, candidate] of valid.entries()) {
        const { score: value, embedding, seconds } = /** @type {Evaluation} */ (evaluations[i]);
        scored.push({ id: candidate.id, score: value, embedding });
        results.evaluated.push({ candidateId: candidate.id, score: value });
        results.timings.push(seconds);
      }
      const { shown, foldedUnder } = shownPoints(scored);
      results.shown = shown;
      results.foldedUnder = Object.fromEntries(foldedUnder);
      await writeResults(folder, results);
      asked += count;
      job.progress(asked, total, null);
    }

    /** @type {{ candidateIds: number[], best: ScoredCandidate | null } | null} */
    let controlArm = null;
    if (control) {
      controlArm = await controlNudges(job, {
        score,
        base,
        genome,
        locks,
        constraints,
        batch: { ...batch, sessionId: null },
        origin: { ...origin, operator: OPERATOR.optimizeControl },
        seed,
        budget,
        population,
        results,
        folder,
      });
    }
    const ranked = await rankSession(app, { id: sessionId, vibeId }, job.signal, () =>
      job.progress(total, total, JOB_STEP.ranking),
    );
    return {
      run,
      seed,
      population,
      dimensions: paths.length,
      candidateIds,
      shown: results.shown,
      best: bestOf(results.evaluated),
      control: controlArm,
      ...ranked,
    };
  };
}

/**
 * The control arm: `budget` medium nudge children of the base, each scored as a search point
 * is, in batches of the search's population, stored outside any session. A child whose every
 * draw fails is no evaluation.
 * @param {JobContext} job
 * @param {object} arm
 * @param {Scorer} arm.score
 * @param {Candidate} arm.base
 * @param {Genome} arm.genome the base's, without the locks applied, as `nudge` takes it
 * @param {readonly Lock[]} arm.locks
 * @param {Constraints} arm.constraints
 * @param {Parameters<typeof keep>[0]} arm.batch
 * @param {Parameters<typeof keep>[3]} arm.origin
 * @param {number} arm.seed
 * @param {number} arm.budget
 * @param {number} arm.population
 * @param {SearchResults} arm.results written with the control's scores after each batch
 * @param {string} arm.folder
 */
async function controlNudges(job, arm) {
  const { score, base, genome, locks, constraints, batch, seed, budget, population } = arm;
  const children = nudge({
    base: genome,
    baseId: base.id,
    locks,
    constraints,
    stepSize: SEARCH_STEP_SIZE,
    seed,
    count: budget,
  });
  const origin = {
    ...arm.origin,
    operatorParams: { ...arm.origin.operatorParams, stepSize: SEARCH_STEP_SIZE },
  };
  /** @type {number[]} */
  const candidateIds = [];
  /** @type {Candidate[]} */
  const made = [];
  for (const draws of children) {
    for (const draw of draws) {
      const candidate = keep(batch, null, verdictOf(draw), origin);
      candidateIds.push(candidate.id);
      if (draw.genome) made.push(candidate);
    }
  }
  /** @type {ScoredCandidate[]} */
  const evaluated = [];
  arm.results.control = { evaluated };
  const batches = Math.ceil(made.length / population);
  for (let b = 0; b < batches; b++) {
    const chunk = made.slice(b * population, (b + 1) * population);
    job.progress(budget + b * population, 2 * budget, JOB_STEP.searchControl(b + 1, batches));
    job.signal.throwIfAborted();
    const evaluations = await score(chunk, job.signal);
    for (const [i, candidate] of chunk.entries()) {
      const { score: value, seconds } = /** @type {Evaluation} */ (evaluations[i]);
      evaluated.push({ candidateId: candidate.id, score: value });
      arm.results.timings.push(seconds);
    }
    await writeResults(arm.folder, arm.results);
  }
  job.progress(2 * budget, 2 * budget, null);
  return { candidateIds, best: bestOf(evaluated) };
}

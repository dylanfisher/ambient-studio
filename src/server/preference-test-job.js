// The taste model test (decision 0045): for each vibe with enough A/B ratings, fit the model on
// every session but one and score the held-out session's pairs, then report the agreement with
// a session bootstrap interval beside three baselines: always-left, louder wins and the same
// model with no CLAP terms. Folds come from `sessionFolds` (0043) and are fitted through
// `modelPlan` and `fitModels` (0044), so nothing from the held-out session reaches a file a
// fold's fit reads. CPU only, through the sidecar; omlx is never asked. Only the owner starts it.
/** @import { Agreement, SessionTally } from "../domain/preference-report.js" */
/** @import { Item, Missing, Pair, TrainingSet } from "../domain/training-set.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { PREFERENCE_MINIMUM, shortfall } from "../domain/preference-minimum.js";
import { agreement, BOOTSTRAP, credit } from "../domain/preference-report.js";
import { sessionFolds } from "../domain/session-folds.js";
import { readEmbedder } from "./embed-audio.js";
import { fitModels, readModelCode } from "./fit-job.js";
import { JOB_STEP } from "./job-steps.js";
import { predictScores } from "./predict-scores.js";
import { HYPERPARAMETERS, modelFile, modelPlan } from "./preference-model.js";
import { writePreferenceTest } from "./preference-test-store.js";
import { listRatedAudio } from "./rating-store.js";
import { readTrainingSet } from "./read-training-set.js";
import { listVibes } from "./vibe-store.js";

/**
 * What "louder wins" compares: the loudest 3 s window of the raw render plus the gain normalize
 * applied, which is the loudest 3 s as heard before the limiter. Integrated loudness is the
 * vibe's target for every heard excerpt, so it can't tell two apart.
 */
const LOUDER_MEASURE = "shortTermMax + gainDb";

/**
 * The two fitted predictors: the model, and the features-only baseline, the same model and
 * prior with no CLAP components.
 */
const VARIANTS = Object.freeze({
  model: HYPERPARAMETERS,
  featuresOnly: Object.freeze({ ...HYPERPARAMETERS, pcaDimension: 0 }),
});
const FITTED = /** @type {[keyof typeof VARIANTS, Readonly<Record<string, number>>][]} */ (
  Object.entries(VARIANTS)
);

/**
 * @typedef {object} PredictorResult
 * @property {Agreement | null} agreement null when nothing was scored
 * @property {number} unscored pairs left unscored because the fold's model had no terms
 */

/**
 * @typedef {object} FoldResult
 * @property {number} sessionId
 * @property {number} scored pairs that aren't ties or leaked
 * @property {number} ties
 * @property {number} leaked
 */

/**
 * @typedef {object} VibeTest
 * @property {number} vibeId
 * @property {string} name
 * @property {number} pairs A/B ratings in the set, a tie counted once
 * @property {number} ties
 * @property {number} thumbs
 * @property {number} sessions the sessions those ratings came from
 * @property {number} noFeatures ratings left out for having no features under this engine
 * @property {number | null} noSound ratings left out for having no embedding; null when the
 *   sound analysis wasn't checked, since no vibe had enough ratings without it
 * @property {{ pairs: number, sessions: number } | null} shortfall
 * @property {null | { folds: FoldResult[], scored: number, ties: number, leaked: number,
 *   model: PredictorResult, featuresOnly: PredictorResult, alwaysLeft: PredictorResult,
 *   louder: PredictorResult }} test null below the minimum
 */

/**
 * @typedef {object} PreferenceTestReport
 * @property {number} createdAt
 * @property {string | null} embeddingProducer null when no vibe reached the sidecar
 * @property {typeof PREFERENCE_MINIMUM} minimum
 * @property {typeof BOOTSTRAP} bootstrap
 * @property {string} louderMeasure
 * @property {VibeTest[]} vibes oldest first
 */

/** @param {{ ratingId: number }[]} rows */
const ratingCount = (rows) => new Set(rows.map((row) => row.ratingId)).size;

/**
 * @param {TrainingSet} set
 * @param {number} noFeatures
 * @param {number | null} noSound
 */
function counted(set, noFeatures, noSound) {
  const pairs = ratingCount(set.pairs);
  const sessions = new Set(set.pairs.map((p) => p.sessionId)).size;
  return {
    pairs,
    ties: ratingCount(set.pairs.filter((p) => p.tie)),
    thumbs: set.thumbs.length,
    sessions,
    noFeatures,
    noSound,
    shortfall: shortfall(pairs, sessions),
  };
}

/** @param {Missing[]} entries */
const missingRatings = (entries) =>
  new Set(
    entries.flatMap((e) => {
      const { ratingId } = /** @type {{ ratingId?: number }} */ (e);
      return ratingId === undefined ? [] : [ratingId];
    }),
  ).size;

/**
 * Every excerpt the pairs name, once each.
 * @param {Pair[]} pairs
 * @returns {Item[]}
 */
function itemsOf(pairs) {
  /** @type {Map<number, Item>} */
  const items = new Map();
  for (const item of pairs.flatMap((p) => [p.winner, p.loser])) {
    if (!items.has(item.ratedAudioId)) items.set(item.ratedAudioId, item);
  }
  return [...items.values()];
}

/**
 * The job.
 * @param {App} app
 * @returns {(job: JobContext) => Promise<{ vibes: number }>}
 */
export function preferenceTestJob(app) {
  return async ({ signal, progress }) => {
    const { store } = app;
    progress(0, 0, JOB_STEP.testingCount);
    const vibes = listVibes(store);
    // Counted before any embedding is read: a vibe short of the minimum here stays short,
    // and when every vibe is, the sidecar is never started.
    const first = vibes.map((vibe) => {
      const set = readTrainingSet(store, vibe.id);
      return counted(set, missingRatings(set.missing), null);
    });
    /** @type {VibeTest[]} */
    const results = vibes.map((vibe, i) => ({
      vibeId: vibe.id,
      name: vibe.revision.name,
      .../** @type {ReturnType<typeof counted>} */ (first[i]),
      test: null,
    }));
    /** @type {string | null} */
    let embeddingProducer = null;
    if (first.some((c) => c.shortfall === null)) {
      const embedder = await readEmbedder(app, { fetch: false, signal });
      if (typeof embedder === "string") {
        throw new Error(
          `the taste test reads each rated excerpt's sound analysis, and ${embedder}`,
        );
      }
      const { producer, dimension } = embedder;
      embeddingProducer = producer;
      const modelCode = await readModelCode(app, signal);
      const whole = modelPlan(store, producer, { modelCode });
      const gains = new Map(listRatedAudio(store).map((row) => [row.id, row.gainDb]));
      /** @param {Item} item */
      const loudest = (item) => {
        const shortTermMax = item.features.shortTermMax ?? null;
        const gain = gains.get(item.ratedAudioId);
        if (gain === undefined) throw new Error(`there is no rated audio ${item.ratedAudioId}`);
        return shortTermMax === null ? null : shortTermMax + gain;
      };
      const work = results.flatMap((result) => {
        if (result.shortfall !== null) return [];
        const planned = whole.vibes.find((v) => v.vibeId === result.vibeId);
        if (!planned) throw new Error(`the model plan has no brief ${result.vibeId}`);
        Object.assign(
          result,
          counted(planned.set, result.noFeatures, missingRatings(planned.unembedded)),
        );
        return result.shortfall === null ? [{ result, set: planned.set }] : [];
      });
      const total = work.reduce((sum, { set }) => sum + sessionFolds(set).length, 0);
      let done = 0;
      for (const [n, { result, set }] of work.entries()) {
        const folds = sessionFolds(set);
        /** @type {() => SessionTally[]} */
        const none = () => [];
        const tallies = { model: none(), featuresOnly: none(), alwaysLeft: none(), louder: none() };
        const unscored = { model: 0, featuresOnly: 0 };
        /** @type {FoldResult[]} */
        const foldResults = [];
        for (const [f, fold] of folds.entries()) {
          signal.throwIfAborted();
          progress(done, total, JOB_STEP.testingFold(n + 1, work.length, f + 1, folds.length));
          const scored = fold.test.filter((p) => !p.tie);
          const { sessionId } = fold;
          foldResults.push({
            sessionId,
            scored: scored.length,
            ties: ratingCount(fold.test.filter((p) => p.tie)),
            leaked: ratingCount(fold.leaked),
          });
          /** @param {(pair: Pair) => number} call */
          const tally = (call) => ({
            sessionId,
            agreed: scored.reduce((sum, pair) => sum + call(pair), 0),
            scored: scored.length,
          });
          tallies.alwaysLeft.push(tally((p) => (p.winnerLeft ? 1 : 0)));
          tallies.louder.push(tally((p) => credit(loudest(p.winner), loudest(p.loser))));
          for (const [name, hyperparameters] of FITTED) {
            if (scored.length === 0) {
              tallies[name].push(tally(() => 0));
              continue;
            }
            const plan = modelPlan(store, producer, {
              modelCode,
              heldOutSession: sessionId,
              hyperparameters,
            });
            const own = plan.vibes.filter((v) => v.vibeId === result.vibeId);
            await fitModels(
              app,
              { ...plan, vibes: own },
              {
                dimension,
                signal,
                onVibe: () => undefined,
              },
            );
            const items = itemsOf(scored);
            const model = modelFile(app.paths, /** @type {{ key: string }} */ (own[0]).key);
            const { mean, variance } = await predictScores(app, model, items, {
              embeddingProducer: producer,
              dimension,
              signal,
            });
            // A model with no terms, as one fitted on no ratings is, scores every excerpt 0
            // with variance 0: it makes no call, so it isn't scored at all.
            if (variance.every((v) => v === 0)) {
              unscored[name] += scored.length;
              tallies[name].push({ sessionId, agreed: 0, scored: 0 });
              continue;
            }
            const scores = new Map(items.map((item, i) => [item.ratedAudioId, mean[i] ?? null]));
            /** @param {Item} item */
            const score = (item) => scores.get(item.ratedAudioId) ?? null;
            tallies[name].push(tally((p) => credit(score(p.winner), score(p.loser))));
          }
          done += 1;
        }
        result.test = {
          folds: foldResults,
          scored: foldResults.reduce((sum, f) => sum + f.scored, 0),
          ties: foldResults.reduce((sum, f) => sum + f.ties, 0),
          leaked: foldResults.reduce((sum, f) => sum + f.leaked, 0),
          model: { agreement: agreement(tallies.model), unscored: unscored.model },
          featuresOnly: {
            agreement: agreement(tallies.featuresOnly),
            unscored: unscored.featuresOnly,
          },
          alwaysLeft: { agreement: agreement(tallies.alwaysLeft), unscored: 0 },
          louder: { agreement: agreement(tallies.louder), unscored: 0 },
        };
      }
      progress(total, total, null);
    }
    /** @type {PreferenceTestReport} */
    const report = {
      createdAt: store.now(),
      embeddingProducer,
      minimum: PREFERENCE_MINIMUM,
      bootstrap: BOOTSTRAP,
      louderMeasure: LOUDER_MEASURE,
      vibes: results,
    };
    await writePreferenceTest(app.paths, report);
    return { vibes: results.length };
  };
}

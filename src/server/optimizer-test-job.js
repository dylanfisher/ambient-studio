// The optimizer test (decision 0059), phase 5's acceptance 4: for each chosen brief with a
// current taste model, 3 runs of the model-in-the-loop search (0054) with its control, from
// bases the owner picks or the brief's top-ranked candidates. Each run's two bests are compared
// by the model, counted only when 4e's held-out agreement beats chance (0045); each run's arms
// give blind spot-check pairs for Quick A/B, with sides from a stored seed; the brief's last
// fill of the map gives coverage against its control (0057); and the timings are set beside the
// estimate. The report is stored in `evaluations`. CPU only, through the sidecar; omlx is never
// asked. Only the owner starts it.
/** @import { StepSeconds } from "../domain/search-cost.js" */
/** @import { Heard, SpotPair } from "../domain/optimizer-report.js" */
/** @import { FillResults } from "./fill-job.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
/** @import { ScorerFactory } from "./search-job.js" */
import { performance } from "node:perf_hooks";
import { AB_ORDER_SEEDS } from "../domain/ab-order.js";
import { applyLocks } from "../domain/apply-locks.js";
import { lockRefusal } from "../domain/nudge.js";
import {
  compareRuns,
  modelVerdict,
  OPTIMIZER_TEST,
  spotPairs,
} from "../domain/optimizer-report.js";
import { PREFERENCE_STATE } from "../domain/preference-text.js";
import { medianTimings, searchSeconds } from "../domain/search-cost.js";
import { requireGenome } from "../engine/validate-genome.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import { addEvaluation, EVALUATION_KIND } from "./evaluation-store.js";
import { readFillResults } from "./fill-job.js";
import { getCandidate, getGenome, listSessionCandidates } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { locksInForce } from "./lock-store.js";
import { currentModel } from "./preference-summary.js";
import { readPreferenceTest } from "./preference-test-store.js";
import { readSearchResults, searchEstimate, searchJob, searchRefusal } from "./search-job.js";
import { numberedRuns } from "./search-run.js";
import { readRanking } from "./session-ranking.js";
import { listSessions } from "./session-store.js";
import { getVibe } from "./vibe-store.js";

/**
 * @typedef {object} OptimizerTestRequest
 * @property {{ vibeId: number, candidateIds: number[] }[]} vibes the chosen briefs, each with
 *   the bases the owner picked, or none for its top-ranked candidates
 * @property {number} budget points each search asks for, and nudges its control makes
 */

/**
 * Whether the brief has a taste model a search can score by: the reason it can't, or the
 * model's key, which the ranking that picks the bases must have been made under.
 * @typedef {(app: App, vibeId: number, signal: AbortSignal) =>
 *   Promise<{ reason: string, key: null } | { reason: null, key: string }>} ModelCheck
 */

/** @type {ModelCheck} */
export async function modelCheck(app, vibeId, signal) {
  const found = await currentModel(app, vibeId, signal);
  const reason = searchRefusal(found);
  if (reason !== null) return { reason, key: null };
  if (found.state !== PREFERENCE_STATE.fitted) throw new Error("searchRefusal passed no model");
  return { reason: null, key: found.planned.key };
}

/**
 * The brief's top-ranked candidates in its open sessions, under the model `key`, best first, one
 * per genome, each able to take the live locks: the bases a test starts from when the owner
 * picks none.
 * @param {App} app
 * @param {number} vibeId
 * @param {string} key
 * @param {number} count
 * @returns {Promise<Candidate[]>}
 */
export async function topRanked(app, vibeId, key, count) {
  const locks = locksInForce(app.store, vibeId);
  /** @type {{ candidate: Candidate, score: number }[]} */
  const ranked = [];
  for (const session of listSessions(app.store, vibeId)) {
    if (session.stoppedAt !== null) continue;
    const ranking = await readRanking(app.paths, session.id);
    if (ranking === null || ranking.modelKey !== key) continue;
    const scores = new Map(ranking.excerpts.map(({ renderId, score }) => [renderId, score]));
    for (const candidate of listSessionCandidates(app.store, session.id)) {
      const render = currentExcerpt(app.store, app.paths.renderCache, candidate);
      const score = render === null ? undefined : scores.get(render.id);
      if (score !== undefined) ranked.push({ candidate, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);
  /** @type {Candidate[]} */
  const bases = [];
  const genomes = new Set();
  for (const { candidate } of ranked) {
    if (bases.length === count) break;
    if (genomes.has(candidate.genomeId)) continue;
    const genome = genomeOf(app, candidate);
    if (lockRefusal(applyLocks(genome, locks)) !== null) continue;
    genomes.add(candidate.genomeId);
    bases.push(candidate);
  }
  return bases;
}

/** @param {App} app @param {Candidate} candidate */
const genomeOf = (app, candidate) =>
  requireGenome(
    candidate.genomeId === null ? undefined : getGenome(app.store, candidate.genomeId)?.genome,
    `candidate ${candidate.id}'s genome`,
  );

/**
 * The newest fill of the brief's map that ran its control, or null when none did.
 * @param {string} searchFolder `paths().search`
 * @param {number} vibeId
 * @returns {Promise<(FillResults & { run: string }) | null>}
 */
async function lastFill(searchFolder, vibeId) {
  for (const run of (await numberedRuns(searchFolder)).reverse()) {
    const fill = await readFillResults(searchFolder, run);
    if (fill?.vibeId === vibeId && fill.coverage.control !== null) return { ...fill, run };
  }
  return null;
}

/**
 * One run of a brief's test.
 * @typedef {object} OptimizerRun
 * @property {string} run the search's run folder
 * @property {number} seed
 * @property {number} baseId
 * @property {number} sessionId the base's, where the points and the spot-check ratings go
 * @property {{ candidateId: number, score: number } | null} search the search's best
 * @property {{ candidateId: number, score: number } | null} control the control's best
 * @property {number} evaluated points the search scored
 * @property {number} controlEvaluated nudges the control scored
 */

/** @typedef {Heard & { candidateId: number }} StoredSide */

/**
 * A stored spot-check pair: `SpotPair` with the run, the place of the two in their arms, and
 * the candidates.
 * @typedef {SpotPair & { run: string, rank: number, search: StoredSide,
 *   control: StoredSide }} StoredSpotPair
 */

/**
 * @typedef {object} OptimizerVibe
 * @property {number} vibeId
 * @property {string} name
 * @property {string | null} leftOut why the brief wasn't tested, or null when it was
 * @property {{ share: number, low: number, high: number, scored: number } | null} agreement
 *   4e's held-out agreement for the model, from its last report, or null without one
 * @property {number | null} agreementAt when that report was made
 * @property {OptimizerRun[]} runs
 * @property {ReturnType<typeof compareRuns>} model
 * @property {ReturnType<typeof modelVerdict>} verdict
 * @property {StoredSpotPair[]} spotChecks
 * @property {(FillResults & { run: string }) | null} coverage the last fill with a control
 * @property {{ estimate: { perEvaluation: StepSeconds, seconds: number, measured: boolean },
 *   took: { perEvaluation: StepSeconds | null, seconds: number, evaluations: number } } | null}
 *   timings null for a brief left out
 */

/**
 * @param {number} vibeId
 * @param {string} name
 * @param {string} reason
 * @returns {OptimizerVibe}
 */
const leftOut = (vibeId, name, reason) => ({
  vibeId,
  name,
  leftOut: reason,
  agreement: null,
  agreementAt: null,
  runs: [],
  model: null,
  verdict: modelVerdict(null, null),
  spotChecks: [],
  coverage: null,
  timings: null,
});

/**
 * 4e's agreement for the brief's model from the last taste test, and when that was.
 * @param {any} report the last `PreferenceTestReport`, or null
 * @param {number} vibeId
 */
function agreementOf(report, vibeId) {
  const found = report?.vibes?.find((/** @type {any} */ v) => v.vibeId === vibeId);
  const agreement = found?.test?.model?.agreement ?? null;
  if (agreement === null) return { agreement: null, agreementAt: null };
  const { share, low, high, scored } = agreement;
  return { agreement: { share, low, high, scored }, agreementAt: report.createdAt };
}

/**
 * The job.
 * @param {App} app
 * @param {OptimizerTestRequest} request
 * @param {object} [options]
 * @param {ScorerFactory} [options.makeScorer] the search's model scorer when omitted; tests
 *   script one
 * @param {ModelCheck} [options.check]
 * @returns {(job: JobContext) => Promise<{ evaluationId: number }>}
 */
export function optimizerTestJob(app, request, { makeScorer, check = modelCheck } = {}) {
  const { runs } = OPTIMIZER_TEST;
  const { budget } = request;
  return async (job) => {
    const { store } = app;
    const perVibe = runs * 2 * budget;
    const total = request.vibes.length * perVibe;
    const estimate = await searchEstimate(app.paths.search);
    const taste = await readPreferenceTest(app.paths);
    /** @type {OptimizerVibe[]} */
    const results = [];
    for (const [v, chosen] of request.vibes.entries()) {
      job.signal.throwIfAborted();
      const { vibeId } = chosen;
      const vibe = getVibe(store, vibeId);
      if (!vibe) throw new Error(`there is no brief ${vibeId}`);
      const name = vibe.revision.name;
      const model = await check(app, vibeId, job.signal);
      if (model.reason !== null) {
        results.push(leftOut(vibeId, name, model.reason));
        continue;
      }
      const bases =
        chosen.candidateIds.length > 0
          ? chosen.candidateIds.map((id) => {
              const found = getCandidate(store, id);
              if (!found) throw new Error(`there is no candidate ${id}`);
              return found;
            })
          : await topRanked(app, vibeId, model.key, runs);
      if (bases.length === 0) {
        results.push(
          leftOut(
            vibeId,
            name,
            "No candidate in an open session is ranked by the current taste model, so there is no base to start from. Ask for candidates in a session, or pick the bases.",
          ),
        );
        continue;
      }
      const started = performance.now();
      /** @type {OptimizerRun[]} */
      const done = [];
      /** @type {StoredSpotPair[]} */
      const spotChecks = [];
      /** @type {StepSeconds[]} */
      const timings = [];
      for (let r = 0; r < runs; r++) {
        const base = /** @type {Candidate} */ (bases[r % bases.length]);
        if (base.sessionId === null) throw new Error(`candidate ${base.id} is in no session`);
        const sessionId = base.sessionId;
        const offset = v * perVibe + r * 2 * budget;
        const search = searchJob(
          app,
          {
            vibeId,
            sessionId,
            base,
            genome: genomeOf(app, base),
            budget,
            raw: [],
            control: true,
          },
          makeScorer ? { makeScorer } : {},
        );
        const result = /** @type {{ run: string, seed: number }} */ (
          await search({
            signal: job.signal,
            progress: (n, _of, step) =>
              job.progress(
                offset + Math.min(n, 2 * budget),
                total,
                step === null
                  ? null
                  : JOB_STEP.optimizerTest(v + 1, request.vibes.length, r + 1, runs, step),
              ),
          })
        );
        const saved = await readSearchResults(app.paths.search, result.run);
        if (!saved) throw new Error(`search ${result.run} wrote no summary`);
        const control = saved.control?.evaluated ?? [];
        const best = (/** @type {{ candidateId: number, score: number }[]} */ list) =>
          list.reduce(
            (/** @type {{ candidateId: number, score: number } | null} */ top, each) =>
              top === null || each.score > top.score ? each : top,
            null,
          );
        done.push({
          run: result.run,
          seed: result.seed,
          baseId: base.id,
          sessionId,
          search: best(saved.evaluated),
          control: best(control),
          evaluated: saved.evaluated.length,
          controlEvaluated: control.length,
        });
        timings.push(...saved.timings);
        for (const pair of spotPairs(saved.evaluated, control, OPTIMIZER_TEST.spotPairsPerRun)) {
          const heard = (/** @type {number} */ id) => {
            const candidate = /** @type {Candidate} */ (getCandidate(store, id));
            return {
              candidateId: id,
              genomeId: /** @type {number} */ (candidate.genomeId),
              seed: candidate.seed,
            };
          };
          spotChecks.push({
            run: result.run,
            rank: pair.rank,
            sessionId,
            orderSeed: Math.floor(app.random() * AB_ORDER_SEEDS),
            search: heard(pair.search),
            control: heard(pair.control),
          });
        }
      }
      const comparison = compareRuns(
        done.map((run) => ({
          search: run.search?.score ?? null,
          control: run.control?.score ?? null,
        })),
      );
      const agreement = agreementOf(taste, vibeId);
      results.push({
        vibeId,
        name,
        leftOut: null,
        ...agreement,
        runs: done,
        model: comparison,
        verdict: modelVerdict(agreement.agreement, comparison),
        spotChecks,
        coverage: await lastFill(app.paths.search, vibeId),
        timings: {
          estimate: {
            perEvaluation: estimate.seconds,
            seconds: searchSeconds(perVibe, estimate.seconds),
            measured: estimate.measured,
          },
          took: {
            perEvaluation: timings.length === 0 ? null : medianTimings(timings),
            seconds: (performance.now() - started) / 1000,
            evaluations: timings.length,
          },
        },
      });
    }
    job.progress(total, total, null);
    const evaluation = addEvaluation(store, {
      params: { kind: EVALUATION_KIND.optimizer, vibes: request.vibes, budget, runs },
      report: { createdAt: store.now(), vibes: results },
    });
    return { evaluationId: evaluation.id };
  };
}

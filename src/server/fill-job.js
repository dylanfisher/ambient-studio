// The map's fill job (decision 0057), MAP-Elites' emitter: each step picks, by the job's seed, an
// elite beside an empty cell of the brief's map and nudges it at the medium step through
// `nudge`, so through `proposeGenome`; the child is stored, rendered and placed on the map, and
// the next step reads the map with it. A share of the steps, none by default, asks the language
// model for a variation of the elite toward the empty side instead, through explore. The axes'
// ends are read once, when the job starts. With the control on, as many medium nudges from the
// elites that were beside an empty cell at the start follow, stored outside any session, and
// both coverages are reported. It runs only when the owner's request adds it to the job runner.
/** @import { StepSeconds } from "../domain/search-cost.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { App } from "./routing.js" */
/** @import { ArchiveContext, AxisReading, MapEntry } from "./vibe-archive.js" */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { applyLocks } from "../domain/apply-locks.js";
import { towardText } from "../domain/axis-words.js";
import { archiveCoverage, besideEmpty, buildArchive } from "../domain/build-archive.js";
import { FILL_STEP_SIZE, isExploreStep } from "../domain/fill-settings.js";
import { lockRefusal, nudge } from "../domain/nudge.js";
import { OPERATOR } from "../domain/operator.js";
import { drawer } from "../engine/prng.js";
import { requireGenome } from "../engine/validate-genome.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { candidateJob, jobRecordings, STREAM_SEEDS } from "./candidate-job.js";
import { embedAudio } from "./embed-audio.js";
import { findEmbedding } from "./embedding-store.js";
import { currentRevision, keep, verdictOf } from "./generate-candidates.js";
import { getCandidate, getGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { locksInForce } from "./lock-store.js";
import { NUDGE_SOURCE } from "./nudge-job.js";
import { renderExcerpt } from "./render-excerpt.js";
import { nextRun, searchRunFolder } from "./search-run.js";
import { rankSession } from "./session-ranking.js";
import { archiveContext, archiveEntries, heldAxes, vibeCandidates } from "./vibe-archive.js";

/** The source a fill's nudge and its control's store: a nudge's. */
const SOURCE = NUDGE_SOURCE;
/** A fill's summary in its run folder, beside a search's `results.json`. */
const FILL = "fill.json";

/**
 * @typedef {object} FillRequest
 * @property {number} vibeId
 * @property {number} sessionId
 * @property {number} budget steps, each one child of an elite
 * @property {number} exploreShare from 0 to 1, the share of steps that ask the model
 * @property {boolean} control whether as many nudges from the starting elites follow
 */

/**
 * Makes a stored candidate's excerpt current, and analyzes its sound when the map reads it;
 * tests script one.
 * @typedef {(app: App, candidate: Candidate, context: ArchiveContext,
 *   recordings: readonly RecordingEntry[], signal: AbortSignal) => Promise<StepSeconds>} PlaceExcerpt
 */

/**
 * Asks the model for a variation of a base and renders it, as the explore route's job does;
 * tests script one.
 * @typedef {(app: App, request: Parameters<typeof candidateJob>[1]) =>
 *   (job: JobContext) => Promise<{ candidateIds: number[] }>} Explore
 */

/**
 * A fill's summary, for the optimizer evaluation (5j). Derived data, as a search's.
 * @typedef {object} FillResults
 * @property {number} vibeId
 * @property {number} budget
 * @property {number} steps taken, fewer than the budget when the map filled first
 * @property {number} explores the steps that asked the model
 * @property {number} cells
 * @property {{ start: number, fill: number, control: number | null }} filled cells
 * @property {{ start: number, fill: number, control: number | null }} coverage filled over cells
 * @property {StepSeconds[]} timings one per child placed, fill and control alike
 */

/** @type {PlaceExcerpt} */
async function renderPlace(app, candidate, context, recordings, signal) {
  // A candidate that passed has a genome row, so it has an excerpt to render.
  const request = /** @type {ExcerptRequest} */ (excerptRequest(app.store, candidate));
  const started = performance.now();
  const { render } = await renderExcerpt(app.store, app.paths.renderCache, request, recordings);
  const rendered = performance.now();
  const { embedder } = context;
  const source = { ratedAudioId: null, renderId: render.id };
  if (embedder !== null && !findEmbedding(app.store, source, embedder.producer)) {
    signal.throwIfAborted();
    await embedAudio(app, embedder, source, join(app.paths.renderCache, render.file), signal);
  }
  const embedded = performance.now();
  return { render: (rendered - started) / 1000, embed: (embedded - rendered) / 1000 };
}

/**
 * A fill's summary, or null when the run is no fill's.
 * @param {string} searchFolder `paths().search`
 * @param {string} run
 * @returns {Promise<FillResults | null>}
 */
export async function readFillResults(searchFolder, run) {
  try {
    return JSON.parse(await readFile(join(searchRunFolder(searchFolder, run), FILL), "utf8"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The candidate's genome, or null when it can't take the live locks, which a nudge needs.
 * @param {App} app
 * @param {number} id
 * @param {Parameters<typeof applyLocks>[1]} locks
 */
function nudgeable(app, id, locks) {
  const candidate = /** @type {Candidate} */ (getCandidate(app.store, id));
  const genome = requireGenome(
    getGenome(app.store, /** @type {number} */ (candidate.genomeId))?.genome,
    `candidate ${id}'s genome is invalid`,
  );
  return lockRefusal(applyLocks(genome, locks)) === null ? { candidate, genome } : null;
}

/**
 * The job that fills the brief's map from `request`, under its current revision and live
 * locks, read when it starts. Progress counts steps, and the control's nudges after them. A
 * cancel stops it at the next step, with every row before it stored.
 * @param {App} app
 * @param {FillRequest} request
 * @param {{ placeExcerpt?: PlaceExcerpt, explore?: Explore }} [options] each renders and
 *   analyzes when omitted, and `explore` asks the model through the candidates job
 * @returns {(job: JobContext) => Promise<unknown>}
 */
export function fillJob(app, request, { placeExcerpt = renderPlace, explore = candidateJob } = {}) {
  const { vibeId, sessionId, budget, exploreShare, control } = request;
  return async (job) => {
    const { signal } = job;
    const recordings = await jobRecordings(app);
    signal.throwIfAborted();
    const context = await archiveContext(app, vibeId, signal);
    if (context.reason !== null) throw new Error(context.reason);
    const read = await archiveEntries(app, context, vibeCandidates(app.store, vibeId), signal);
    const held = heldAxes(context, read.entries);
    const blocked = held.reasons.findIndex((reason) => reason !== null);
    if (blocked >= 0) throw new Error(`Axis ${blocked + 1} of the map: ${held.reasons[blocked]}`);
    const { axes } = held;
    /** @type {MapEntry[]} */
    const entries = [...read.entries];
    const start = buildArchive(axes, entries);
    const firstStarts = besideEmpty(start);
    if (firstStarts.length === 0) {
      throw new Error(
        start.cells.length === 0
          ? "No candidate of this brief is on the map yet, so there is nothing to fill from. Make some candidates first."
          : "Every cell of the map is filled already.",
      );
    }
    const { revision, constraints } = currentRevision(app.store, vibeId);
    const locks = locksInForce(app.store, vibeId);
    const seed = Math.floor(app.random() * STREAM_SEEDS);
    const draw = drawer(seed, ":fill");
    const run = await nextRun(app.paths.search);
    const batch = { store: app.store, vibeId, vibeRevisionId: revision.id, sessionId, locks };
    const total = control ? 2 * budget : budget;
    /** @type {number[]} */
    const candidateIds = [];
    /** @type {StepSeconds[]} */
    const timings = [];
    /** @type {Set<number>} elites that can't take the locks */
    const unusable = new Set();

    /** @param {Candidate} candidate @returns {Promise<MapEntry[]>} */
    const place = async (candidate) => {
      timings.push(await placeExcerpt(app, candidate, context, recordings, signal));
      return (await archiveEntries(app, context, [candidate], signal)).entries;
    };

    let steps = 0;
    let explores = 0;
    while (steps < budget) {
      signal.throwIfAborted();
      const starts = besideEmpty(buildArchive(axes, entries)).filter(
        ({ eliteId }) => !unusable.has(eliteId),
      );
      if (starts.length === 0) break;
      const from = /** @type {(typeof starts)[number]} */ (
        starts[Math.floor(draw(steps, 0) * starts.length)]
      );
      const base = nudgeable(app, from.eliteId, locks);
      if (base === null) {
        unusable.add(from.eliteId);
        continue;
      }
      const step = JOB_STEP.filling(steps + 1, budget);
      job.progress(steps, total, step);
      if (isExploreStep(steps, exploreShare)) {
        explores += 1;
        const direction = towardText(
          /** @type {AxisReading} */ (context.axes[from.axis]),
          from.sign,
        );
        const asked = await explore(app, {
          vibeId,
          sessionId,
          count: 1,
          explore: { base: base.candidate, genome: base.genome, direction },
        })({ signal, progress: (_done, _of, said) => job.progress(steps, total, said ?? step) });
        candidateIds.push(...asked.candidateIds);
        const made = asked.candidateIds.map(
          (id) => /** @type {Candidate} */ (getCandidate(app.store, id)),
        );
        entries.push(...(await archiveEntries(app, context, made, signal)).entries);
      } else {
        const [draws = []] = nudge({
          base: base.genome,
          baseId: base.candidate.id,
          locks,
          constraints,
          stepSize: FILL_STEP_SIZE,
          seed: Math.floor(draw(steps, 1) * STREAM_SEEDS),
          count: 1,
        });
        const origin = {
          seed: base.candidate.seed,
          source: SOURCE,
          parentIds: [base.candidate.id],
          operator: OPERATOR.elite,
          operatorParams: { run, seed, step: steps, stepSize: FILL_STEP_SIZE, to: from.to },
        };
        for (const each of draws) {
          const candidate = keep(batch, null, verdictOf(each), origin);
          candidateIds.push(candidate.id);
          if (each.genome) entries.push(...(await place(candidate)));
        }
      }
      steps += 1;
      job.progress(steps, total, null);
    }
    const filled = buildArchive(axes, entries);

    /** @type {{ candidateIds: number[], filled: number, coverage: number } | null} */
    let controlArm = null;
    if (control) {
      // The same number of nudges as the fill took steps, shared out over the starting elites.
      const elites = [...new Set(firstStarts.map(({ eliteId }) => eliteId))]
        .map((id) => nudgeable(app, id, locks))
        .filter((found) => found !== null);
      /** @type {MapEntry[]} */
      const controlEntries = [...read.entries];
      /** @type {number[]} */
      const controlIds = [];
      let made = 0;
      for (const [j, { candidate: from, genome }] of elites.entries()) {
        const count = Math.floor(steps / elites.length) + (j < steps % elites.length ? 1 : 0);
        if (count === 0) continue;
        const children = nudge({
          base: genome,
          baseId: from.id,
          locks,
          constraints,
          stepSize: FILL_STEP_SIZE,
          seed,
          count,
        });
        const origin = {
          seed: from.seed,
          source: SOURCE,
          parentIds: [from.id],
          operator: OPERATOR.eliteControl,
          operatorParams: { run, seed, stepSize: FILL_STEP_SIZE },
        };
        for (const draws of children) {
          job.progress(budget + made, total, JOB_STEP.fillControl(made + 1, steps));
          signal.throwIfAborted();
          for (const each of draws) {
            const candidate = keep({ ...batch, sessionId: null }, null, verdictOf(each), origin);
            controlIds.push(candidate.id);
            if (each.genome) controlEntries.push(...(await place(candidate)));
          }
          made += 1;
        }
      }
      job.progress(total, total, null);
      const controlled = buildArchive(axes, controlEntries);
      controlArm = {
        candidateIds: controlIds,
        filled: controlled.cells.length,
        coverage: archiveCoverage(controlled),
      };
    }

    /** @type {FillResults} */
    const results = {
      vibeId,
      budget,
      steps,
      explores,
      cells: start.total,
      filled: {
        start: start.cells.length,
        fill: filled.cells.length,
        control: controlArm?.filled ?? null,
      },
      coverage: {
        start: archiveCoverage(start),
        fill: archiveCoverage(filled),
        control: controlArm?.coverage ?? null,
      },
      timings,
    };
    const folder = searchRunFolder(app.paths.search, run);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${FILL}.partial`), JSON.stringify(results));
    await rename(join(folder, `${FILL}.partial`), join(folder, FILL));
    const ranked = await rankSession(app, { id: sessionId, vibeId }, signal, () =>
      job.progress(total, total, JOB_STEP.ranking),
    );
    const { timings: _timings, ...summary } = results;
    return {
      run,
      seed,
      ...summary,
      candidateIds,
      control: controlArm && { candidateIds: controlArm.candidateIds },
      ...ranked,
    };
  };
}

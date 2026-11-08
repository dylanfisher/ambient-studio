// The search by ear (decision 0055): preferential BO in the sidecar from a base candidate. Each
// query is the run's best against one new point, which the owner answers on the Quick A/B page
// with an ordinary A/B rating; the answer is told to the optimizer, and a win makes the new point
// the best. While the owner listens, the job copies the run once for each answer the owner could
// give, tells each copy that answer, and renders the point it would ask next, so the next
// excerpt is in the render cache before it is asked for. A rejected point is stored, told as a
// loss and never shown. Nothing is sent to the language model, and nothing runs once the job
// ends: the job is the owner's, from Search by ear until the budget, Stop or a cancel.
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { Render } from "./render-store.js" */
/** @import { App } from "./routing.js" */
/** @import { SearchResults } from "./search-job.js" */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  EAR_DRAWS,
  EAR_OPTIMIZER,
  EAR_PHASE,
  EAR_REJECTS,
  EAR_SCORE,
  MAX_EAR_DIMENSIONS,
} from "../domain/ear-settings.js";
import { OPERATOR } from "../domain/operator.js";
import { proposeGenome } from "../domain/propose-genome.js";
import { OUTCOMES } from "../domain/rating-values.js";
import { SEARCH_SIGMA } from "../domain/search-settings.js";
import { canonicalGenome } from "../engine/canonical-genome.js";
import { toVector } from "../engine/vector-view.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { jobRecordings, STREAM_SEEDS } from "./candidate-job.js";
import { keep } from "./generate-candidates.js";
import { putGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { verdictOf } from "./nudge-job.js";
import { renderExcerpt } from "./render-excerpt.js";
import { SEARCH_SOURCE, writeResults } from "./search-job.js";
import {
  askPoints,
  forkSearch,
  nextRun,
  searchStart,
  startSearch,
  tellScores,
} from "./search-run.js";

const [, , , SKIP] = OUTCOMES;
/** Each answer the owner could give, in the order the job renders its next point. */
const BRANCHES = /** @type {const} */ ([
  ["loss", EAR_SCORE.loss],
  ["win", EAR_SCORE.win],
  ["tie", EAR_SCORE.tie],
  [SKIP, null],
]);
/** What `EarChannel.wait` gives when the owner pressed Stop. */
const STOP = Symbol("the owner pressed Stop");

/**
 * @typedef {object} EarRequest
 * @property {number} vibeId
 * @property {number} sessionId
 * @property {Candidate} base
 * @property {Genome} genome the base's
 * @property {number} budget queries the owner answers at most
 * @property {readonly string[]} raw the owner's chosen raw paths; none by default
 */

/**
 * A candidate the page can play: what Quick A/B's pool holds.
 * @typedef {{ id: number, genomeId: number, seed: number,
 *   excerpt: { renderId: number, url: string, duration: number } }} Playable
 */

/**
 * What the Quick A/B page reads of a search by ear.
 * @typedef {object} EarView
 * @property {number | null} jobId
 * @property {(typeof EAR_PHASE)[keyof typeof EAR_PHASE]} phase drawing and rendering the next query,
 *   waiting for the owner's answer, or ended
 * @property {number} query the query asked or being drawn, counted from 0
 * @property {number} budget
 * @property {number} answered queries answered, skips included
 * @property {Playable | null} best the run's best: the base until a new point wins
 * @property {Playable | null} challenger the new point, while asking
 * @property {number} ready how many of the four next points are rendered, while asking
 * @property {boolean} stopped whether the owner pressed Stop
 * @property {string | null} error why the job ended without finishing, once it has
 */

/**
 * The job's link to the routes: the page reads `view`, and an answer or a Stop reaches the job
 * waiting in `wait`.
 * @typedef {object} EarChannel
 * @property {() => EarView} view
 * @property {(patch: Partial<EarView>) => void} publish
 * @property {(query: number, signal: AbortSignal) => Promise<number | null | typeof STOP>} wait
 *   resolves with the score of the owner's answer to `query`, or `STOP`
 * @property {(query: number, score: number | null) => void} answer throws unless the job waits
 *   for `query`
 * @property {(query: number) => Promise<EarView>} after resolves with the view once the job
 *   asks a later query than `query`, or ends, so an answer's reply carries the next pair
 * @property {() => void} stop
 */

/**
 * @param {number} budget
 * @returns {EarChannel}
 */
export function createEarChannel(budget) {
  /** @type {EarView} */
  let view = {
    jobId: null,
    phase: EAR_PHASE.drawing,
    query: 0,
    budget,
    answered: 0,
    best: null,
    challenger: null,
    ready: 0,
    stopped: false,
    error: null,
  };
  /** @type {{ query: number, resolve: (value: number | null | typeof STOP) => void } | null} */
  let waiting = null;
  /** @type {{ query: number, resolve: (view: EarView) => void }[]} */
  let watchers = [];
  /** @param {number} query */
  const past = (query) =>
    view.phase === EAR_PHASE.finished || (view.phase === EAR_PHASE.listening && view.query > query);
  return {
    view: () => view,
    publish(patch) {
      view = { ...view, ...patch };
      const due = watchers.filter(({ query }) => past(query));
      watchers = watchers.filter(({ query }) => !past(query));
      for (const { resolve } of due) resolve(view);
    },
    after: (query) =>
      past(query)
        ? Promise.resolve(view)
        : new Promise((resolve) => {
            watchers.push({ query, resolve });
          }),
    wait: (query, signal) =>
      new Promise((resolve, reject) => {
        if (view.stopped) {
          resolve(STOP);
          return;
        }
        const abort = () => {
          waiting = null;
          reject(signal.reason);
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        waiting = {
          query,
          resolve: (value) => {
            signal.removeEventListener("abort", abort);
            waiting = null;
            resolve(value);
          },
        };
      }),
    answer(query, score) {
      if (waiting?.query !== query) {
        throw new Error(
          view.phase === EAR_PHASE.finished
            ? "This search by ear has ended, so it takes no more answers."
            : `The search by ear is not waiting for an answer to pair ${query + 1}.`,
        );
      }
      waiting.resolve(score);
    },
    stop() {
      view = { ...view, stopped: true };
      waiting?.resolve(STOP);
    },
  };
}

/** @type {WeakMap<App, Map<number, EarChannel>>} each session's latest search by ear */
const channels = new WeakMap();

/**
 * The session's latest search by ear since the server started, or null.
 * @param {App} app
 * @param {number} sessionId
 */
export const earChannel = (app, sessionId) => channels.get(app)?.get(sessionId) ?? null;

/**
 * Makes the session's latest search by ear `channel`.
 * @param {App} app
 * @param {number} sessionId
 * @param {EarChannel} channel
 */
export function setEarChannel(app, sessionId, channel) {
  const map = channels.get(app) ?? new Map();
  map.set(sessionId, channel);
  channels.set(app, map);
}

/**
 * Renders the excerpt a query plays, or takes it from the cache.
 * @typedef {(app: App, request: ExcerptRequest, recordings: readonly RecordingEntry[]) =>
 *   Promise<Render>} Prepare
 */

/** @type {Prepare} */
const renderPrepared = async (app, request, recordings) =>
  (await renderExcerpt(app.store, app.paths.renderCache, request, recordings)).render;

/**
 * @param {Candidate} candidate
 * @param {Render} render
 * @returns {Playable}
 */
const playable = ({ id, seed }, render) => ({
  id,
  genomeId: render.genomeId,
  seed,
  excerpt: { renderId: render.id, url: `/audio/${render.id}`, duration: render.duration },
});

/**
 * The job that searches by ear from `base` under the vibe's current revision and live locks,
 * read when it starts. Progress counts queries answered.
 * @param {App} app
 * @param {EarRequest} request
 * @param {EarChannel} channel
 * @param {{ prepare?: Prepare }} [options] renders through the cache when omitted; tests
 *   script it
 * @returns {(job: JobContext) => Promise<unknown>}
 */
export function earSearchJob(app, request, channel, { prepare = renderPrepared } = {}) {
  return async (job) => {
    /** @type {string | null} */
    let error = null;
    try {
      return await searchByEar(app, request, channel, prepare, job);
    } catch (thrown) {
      error = job.signal.aborted
        ? "The search was cancelled."
        : thrown instanceof Error
          ? thrown.message
          : String(thrown);
      throw thrown;
    } finally {
      channel.publish({ phase: EAR_PHASE.finished, challenger: null, ready: 0, error });
    }
  };
}

/**
 * @param {App} app
 * @param {EarRequest} request
 * @param {EarChannel} channel
 * @param {Prepare} prepare
 * @param {JobContext} job
 */
async function searchByEar(app, request, channel, prepare, job) {
  const { vibeId, sessionId, base, genome, budget, raw } = request;
  const { signal } = job;
  const recordings = await jobRecordings(app);
  signal.throwIfAborted();
  const { revision, constraints, locks, start, paths } = searchStart(app, {
    vibeId,
    base,
    genome,
    raw,
  });
  if (paths.length > MAX_EAR_DIMENSIONS) {
    throw new Error(
      `a search by ear takes at most ${MAX_EAR_DIMENSIONS} dimensions, and this one has ${paths.length}`,
    );
  }
  const dimension = paths.length;
  const seed = Math.floor(app.random() * STREAM_SEEDS);
  const run = await nextRun(app.paths.search);
  const spec = {
    optimizer: EAR_OPTIMIZER,
    start: toVector(start, paths),
    seed,
    settings: { sigma: SEARCH_SIGMA, draws: EAR_DRAWS },
  };
  const folder = await startSearch(app, run, spec, { signal });
  const batch = { store: app.store, vibeId, vibeRevisionId: revision.id, sessionId, locks };
  const origin = {
    seed: base.seed,
    source: SEARCH_SOURCE,
    parentIds: [base.id],
    operator: OPERATOR.optimizeEar,
    operatorParams: { run, seed, budget, paths },
  };
  /** @type {Map<string, string>} */
  const seen = new Map([[canonicalGenome(start), `candidate ${base.id}, the base`]]);
  const context = { locks, constraints };
  const baseRequest = excerptRequest(app.store, base);
  if (baseRequest === null) throw new Error(`candidate ${base.id} has no genome to search from`);
  // Every point is made under the current revision, so it plays at its loudness target.
  const target = /** @type {ExcerptRequest} */ (
    excerptRequest(app.store, { ...base, vibeRevisionId: revision.id })
  ).target;

  /**
   * The next point that passes, from the ask numbered `generation`: each rejected one is told
   * as a loss and asked again. With `store`, every point is stored as a session candidate.
   * @param {string} runFolder
   * @param {number} generation
   * @param {Map<string, string>} known the genomes a point would repeat
   * @param {number | null} query the query it is for, when stored
   */
  async function draw(runFolder, generation, known, query) {
    /** @type {Candidate[]} */
    const stored = [];
    for (let rejects = 0; ; rejects++) {
      const [point] = await askPoints(app, runFolder, { generation, count: 1, dimension, signal });
      const proposal = proposeGenome(start, paths, /** @type {number[]} */ (point), {
        ...context,
        seen: known,
      });
      if (query !== null) {
        const operatorParams = { ...origin.operatorParams, query, generation };
        stored.push(keep(batch, null, verdictOf(proposal), { ...origin, operatorParams }));
      }
      if (proposal.genome) return { generation, genome: proposal.genome, stored };
      if (rejects + 1 === EAR_REJECTS) {
        throw new Error(
          `the search's last ${EAR_REJECTS} points all broke the brief's rules or repeated a genome, so it stopped; try a base further from the rules' edges`,
        );
      }
      await tellScores(app, runFolder, generation, [EAR_SCORE.loss], signal);
      generation++;
    }
  }

  /**
   * Renders the point each answer to the query would bring next, in `BRANCHES` order, until
   * `halt` aborts. It stops only between steps, so a sidecar request is never cut off, which
   * would restart the sidecar.
   * @param {number} generation the query's ask
   * @param {AbortSignal} halt
   */
  async function speculate(generation, halt) {
    let ready = 0;
    for (const [name, score] of BRANCHES) {
      if (halt.aborted) return;
      const fork = await forkSearch(folder, `branch-${generation}-${name}`, generation);
      await tellScores(app, fork, generation, [score], signal);
      if (halt.aborted) return;
      /** @type {Awaited<ReturnType<typeof draw>>} */
      let next;
      try {
        next = await draw(fork, generation + 1, new Map(seen), null);
      } catch (error) {
        // The run itself draws the same points if this answer comes, and fails there.
        if (signal.aborted) throw error;
        continue;
      }
      if (halt.aborted) return;
      const { id } = putGenome(app.store, vibeId, next.genome);
      await prepare(app, { genomeId: id, seed: base.seed, target }, recordings);
      ready++;
      channel.publish({ ready });
    }
  }

  /** Removes the run's copies, which nothing reads once the answer is told. */
  async function removeForks() {
    for (const name of await readdir(folder)) {
      if (name.startsWith("branch-")) await rm(join(folder, name), { recursive: true });
    }
  }

  let best = { candidate: base, render: await prepare(app, baseRequest, recordings) };
  /** @type {number[]} */
  const candidateIds = [];
  /** @type {number[]} */
  const points = [];
  /** @type {SearchResults} */
  const results = {
    paths,
    baseId: base.id,
    evaluated: [],
    shown: [],
    foldedUnder: {},
    // The owner, not a distance, chooses the one point shown.
    minDistance: 0,
    timings: [],
    control: null,
  };
  const summarize = async () => {
    results.shown = best.candidate === base ? [] : [best.candidate.id];
    results.foldedUnder = Object.fromEntries(
      points.filter((id) => id !== best.candidate.id).map((id) => [id, best.candidate.id]),
    );
    await writeResults(folder, results);
  };
  channel.publish({ best: playable(best.candidate, best.render) });
  let generation = 0;
  let answered = 0;
  for (let query = 0; query < budget && !channel.view().stopped; query++) {
    job.progress(answered, budget, JOB_STEP.earDrawing(query + 1, budget));
    channel.publish({ phase: EAR_PHASE.drawing, query, challenger: null, ready: 0 });
    const drawn = await draw(folder, generation, seen, query);
    generation = drawn.generation;
    const challenger = /** @type {Candidate} */ (drawn.stored.at(-1));
    candidateIds.push(...drawn.stored.map(({ id }) => id));
    points.push(challenger.id);
    seen.set(canonicalGenome(drawn.genome), `query ${query + 1}`);
    const request = /** @type {ExcerptRequest} */ (excerptRequest(app.store, challenger));
    const render = await prepare(app, request, recordings);
    await summarize();
    signal.throwIfAborted();
    channel.publish({
      phase: EAR_PHASE.listening,
      challenger: playable(challenger, render),
      ready: 0,
    });
    job.progress(answered, budget, JOB_STEP.earListening(query + 1, budget));
    const halt = new AbortController();
    const ahead = query + 1 < budget ? speculate(generation, halt.signal) : Promise.resolve();
    // A rejected speculation is read after the answer, so it never goes unhandled meanwhile.
    ahead.catch(() => undefined);
    /** @type {number | null | typeof STOP} */
    let answer;
    try {
      answer = await channel.wait(query, signal);
    } finally {
      halt.abort();
    }
    await ahead;
    await removeForks();
    if (answer === STOP) break;
    channel.publish({ phase: EAR_PHASE.drawing, challenger: null, ready: 0 });
    await tellScores(app, folder, generation, [answer], signal);
    generation++;
    answered++;
    channel.publish({ answered });
    if (answer === EAR_SCORE.win) best = { candidate: challenger, render };
    channel.publish({ best: playable(best.candidate, best.render) });
    await summarize();
  }
  job.progress(answered, budget, null);
  return {
    run,
    seed,
    dimensions: dimension,
    answered,
    stopped: channel.view().stopped,
    best: best.candidate.id,
    candidateIds,
  };
}

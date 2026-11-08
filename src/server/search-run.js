// A search run in the sidecar's optimizer, one generation at a time (decision 0053). The run is a
// folder under the data root holding the spec, the sidecar's state and each generation's points
// and scores as JSON. Python proposes points in [0, 1]^d; here each becomes a genome through
// `proposeGenome`, every one is stored as a candidate, and only those that pass are scored. A
// rejected point is told a penalty and never rendered. A sidecar failure fails the caller, and
// nothing is retried.
/** @import { ProposalContext } from "../domain/propose-genome.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { CandidateOrigin } from "./generate-candidates.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { App } from "./routing.js" */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { penalizedScores } from "../domain/penalized-scores.js";
import { proposeGenome } from "../domain/propose-genome.js";
import { canonicalGenome } from "../engine/canonical-genome.js";
import { keep } from "./generate-candidates.js";
import { verdictOf } from "./nudge-job.js";

/** The data root's folder of search runs, one folder each. */
const SEARCH_FOLDER = "search";
const SPEC = "spec.json";
// A run's name is a folder name; letters, digits and dashes keep it inside the search folder.
const RUN_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * What the sidecar's optimizer starts from.
 * @typedef {object} SearchSpec
 * @property {string} optimizer a name the sidecar's `OPTIMIZERS` holds
 * @property {number[]} start the base's position in the space, each from 0 to 1
 * @property {number} seed a whole number from 0
 * @property {Record<string, unknown>} settings the optimizer's own
 */

/**
 * @typedef {object} SearchGeneration
 * @property {number} generation counted from 0; names the generation's files
 * @property {number} count how many points to ask for
 * @property {Genome} start the base, with the locks applied
 * @property {readonly string[]} paths the search space, from `searchSpace`
 * @property {ProposalContext & { seen: Map<string, string> }} context `seen` takes each valid
 *   point, so a later point that repeats it is rejected
 * @property {Parameters<typeof keep>[0]} batch what `keep` reads of a batch
 * @property {CandidateOrigin} origin each point's candidate stores it, with `generation` and
 *   `point` added to its `operatorParams`
 * @property {(candidates: Candidate[], signal: AbortSignal) => Promise<number[]>} evaluate
 *   renders and scores the candidates that passed, one `searchScore` each, in order
 * @property {AbortSignal} signal
 */

/**
 * @typedef {object} GenerationResult
 * @property {number[][]} points as the optimizer gave them
 * @property {Candidate[]} candidates one per point, rejected ones included
 * @property {(number | null)[]} scores each valid point's score; null for a rejected one
 * @property {number[]} told what the optimizer was told, penalties included
 */

/**
 * A run's folder. Throws on a name that isn't a plain folder name.
 * @param {string} dataRoot
 * @param {string} run
 */
export function searchRunFolder(dataRoot, run) {
  if (!RUN_NAME.test(run)) throw new Error(`a search run's name must match ${RUN_NAME}: ${run}`);
  return join(dataRoot, SEARCH_FOLDER, run);
}

/** A numbered run's name; the search job numbers its runs from 1 (decision 0054). */
const NUMBERED = /^run-([1-9]\d*)$/;

/**
 * The numbered runs under the data root, oldest first.
 * @param {string} dataRoot
 * @returns {Promise<string[]>}
 */
export async function numberedRuns(dataRoot) {
  /** @type {string[]} */
  let names;
  try {
    names = await readdir(join(dataRoot, SEARCH_FOLDER));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw error;
  }
  const numbered = names.flatMap((name) => {
    const match = NUMBERED.exec(name);
    return match ? [{ name, n: Number(match[1]) }] : [];
  });
  return numbered.sort((a, b) => a.n - b.n).map(({ name }) => name);
}

/**
 * The name the next numbered run takes. One job runs at a time, so two never take one name.
 * @param {string} dataRoot
 */
export async function nextRun(dataRoot) {
  const last = (await numberedRuns(dataRoot)).at(-1);
  return `run-${last === undefined ? 1 : Number(NUMBERED.exec(last)?.[1]) + 1}`;
}

/**
 * Makes the run's folder, writes its spec and starts the optimizer. Throws when the run exists.
 * @param {App} app
 * @param {string} run
 * @param {SearchSpec} spec
 * @param {{ signal: AbortSignal }} options
 * @returns {Promise<string>} the run's folder
 */
export async function startSearch(app, run, spec, { signal }) {
  const folder = searchRunFolder(app.config.dataRoot, run);
  await mkdir(join(app.config.dataRoot, SEARCH_FOLDER), { recursive: true });
  await mkdir(folder);
  const specPath = join(folder, SPEC);
  await writeFile(specPath, JSON.stringify(spec), { flag: "wx" });
  const { dimension } = await app.sidecar.request(
    "optimizer_start",
    { spec: specPath },
    { signal },
  );
  if (dimension !== spec.start.length) {
    throw new Error(
      `optimizer_start read ${dimension} dimensions from a ${spec.start.length}-long start`,
    );
  }
  return folder;
}

/**
 * @param {unknown} points
 * @param {number} count
 * @param {number} dimension
 * @returns {number[][]}
 */
function checkedPoints(points, count, dimension) {
  const fits =
    Array.isArray(points) &&
    points.length === count &&
    points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === dimension &&
        point.every((u) => typeof u === "number" && u >= 0 && u <= 1),
    );
  if (!fits) {
    throw new Error(`optimizer_ask wrote other than ${count} points in [0, 1]^${dimension}`);
  }
  return /** @type {number[][]} */ (points);
}

/**
 * Asks for one generation's points, stores each as a candidate, scores those that passed, and
 * tells the optimizer every score, each rejected point's penalty included.
 * @param {App} app
 * @param {string} folder the run's, from `startSearch`
 * @param {SearchGeneration} request
 * @returns {Promise<GenerationResult>}
 */
export async function searchGeneration(app, folder, request) {
  const { generation, count, start, paths, context, batch, origin, evaluate, signal } = request;
  const asked = join(folder, `ask-${generation}.json`);
  await app.sidecar.request("optimizer_ask", { run: folder, count, out: asked }, { signal });
  const points = checkedPoints(
    JSON.parse(await readFile(asked, "utf8")).points,
    count,
    paths.length,
  );
  const candidates = points.map((point, index) => {
    const proposal = proposeGenome(start, paths, point, context);
    if (proposal.genome) {
      context.seen.set(
        canonicalGenome(proposal.genome),
        `point ${index + 1} of generation ${generation + 1}`,
      );
    }
    const operatorParams = { ...origin.operatorParams, generation, point: index };
    return keep(batch, null, verdictOf(proposal), { ...origin, operatorParams });
  });
  const valid = candidates.filter((candidate) => candidate.rejectReason === null);
  signal.throwIfAborted();
  const validScores = valid.length === 0 ? [] : await evaluate(valid, signal);
  if (validScores.length !== valid.length) {
    throw new Error(`the search scored ${validScores.length} of ${valid.length} valid points`);
  }
  let next = 0;
  const scores = candidates.map((candidate) =>
    candidate.rejectReason === null ? /** @type {number} */ (validScores[next++]) : null,
  );
  const told = penalizedScores(scores);
  signal.throwIfAborted();
  const scoresPath = join(folder, `tell-${generation}.json`);
  await writeFile(scoresPath, JSON.stringify({ scores: told }), { flag: "wx" });
  await app.sidecar.request(
    "optimizer_tell",
    { run: folder, points: asked, scores: scoresPath },
    { signal },
  );
  return { points, candidates, scores, told };
}

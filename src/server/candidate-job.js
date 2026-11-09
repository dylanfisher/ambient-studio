// The session's jobs (decisions 0027, 0031): ask omlx for candidates (0024), render each valid
// one's excerpt as it is made (0026) and revise one that misses (0036), and for a breed nudge
// each child once (0058); or render the excerpts a session's candidates are missing.
// Each runs only when the owner's request adds it to the job runner.
/** @import { Features } from "../domain/extract-features.js" */
/** @import { LintResult } from "../domain/lint-result.js" */
/** @import { BreedFrom, ExploreFrom, GenerationStep } from "./generate-candidates.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { Embedder } from "./embed-audio.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { ExcerptRequest } from "./render-excerpt.js" */
/** @import { Render } from "./render-store.js" */
/** @import { App } from "./routing.js" */

import { join } from "node:path";
import { mutateChild } from "../domain/breed-mutation.js";
import { BREED_STAGE, MUTATION_STEP } from "../domain/breed-settings.js";
import { excerptMisses } from "../domain/excerpt-misses.js";
import { excerptRequest } from "./candidate-excerpt.js";
import { embedAudio, embedText, readEmbedder } from "./embed-audio.js";
import { findEmbedding } from "./embedding-store.js";
import {
  BREED_OPERATOR,
  BREED_SOURCE,
  batchOperator,
  checkRevision,
  GENERATION_STEP,
  generateCandidates,
  keep,
  mutationSeed,
  playableHashes,
  requestGroupName,
  revisedGroupName,
  revisionSeed,
  verdictOf,
} from "./generate-candidates.js";
import { getGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { locksInForce } from "./lock-store.js";
import { ownedBy } from "./omlx-queue.js";
import { promptReferences } from "./prompt-references.js";
import { indexRecordings } from "./recording-index.js";
import { renderExcerpt, renderExcerpts } from "./render-excerpt.js";
import { isUnchanged, reviseCandidate } from "./revise-candidate.js";
import { rankSession } from "./session-ranking.js";
import { getRevision } from "./vibe-store.js";

/** How many candidates one request asks for when it doesn't say. */
export const DEFAULT_CANDIDATES = 8;
/** The most one request may ask for: 32 is a few minutes of omlx and of renders. */
export const MAX_CANDIDATES = 32;
/** Stream seeds are integers in [0, 2^32) (decision 0024). */
export const STREAM_SEEDS = 2 ** 32;

/**
 * @typedef {{ candidateId: number, renderId: number }} CandidateRender
 */

/** Each app's last index of its recordings folder, so a job re-reads only changed files. */
/** @type {WeakMap<App, RecordingEntry[]>} */
const lastIndex = new WeakMap();

/**
 * The recordings folder's index for one job (decision 0029), or none when the config sets no
 * folder. Read once when the job starts, so every candidate and excerpt in it sees one index.
 * @param {App} app
 * @returns {Promise<RecordingEntry[]>}
 */
export async function jobRecordings(app) {
  const folder = app.config.fieldRecordings;
  if (folder === null) return [];
  const index = await indexRecordings(folder, lastIndex.get(app) ?? []);
  lastIndex.set(app, index);
  return index;
}

/**
 * @typedef {object} CandidateJobResult
 * @property {string} requestGroup
 * @property {string} retrievalMethod how the prompt's examples were chosen (decision 0024)
 * @property {number[]} candidateIds every candidate made, rejected ones included, in order
 * @property {CandidateRender[]} excerpts one per valid candidate
 * @property {string | null} notEmbedded why the excerpts weren't embedded, or null when they
 *   were or none was rendered (decision 0042)
 * @property {number} ranked the session's excerpts ranked by the taste model (decision 0046)
 * @property {string | null} notRanked why the session isn't ranked, or null when it is or no
 *   taste model was ever fitted
 */

/**
 * Renders the excerpt of every candidate with a genome, reusing cached ones.
 * @param {App} app
 * @param {Candidate[]} candidates
 * @param {JobContext} job
 * @param {readonly RecordingEntry[]} recordings the job's index
 * @returns {Promise<CandidateRender[]>}
 */
async function renderFor(app, candidates, job, recordings) {
  /** @type {{ candidate: Candidate, request: ExcerptRequest }[]} */
  const wanted = [];
  for (const candidate of candidates) {
    const request = excerptRequest(app.store, candidate);
    if (request) wanted.push({ candidate, request });
  }
  const rendered = await renderExcerpts(
    app.store,
    app.paths.renderCache,
    wanted.map(({ request }) => request),
    job,
    recordings,
  );
  return rendered.map(({ render }, i) => ({
    candidateId: /** @type {{ candidate: Candidate }} */ (wanted[i]).candidate.id,
    renderId: render.id,
  }));
}

/**
 * What a generation step tells the owner, numbering candidate `index` from 1 of `total`.
 * @param {GenerationStep} step
 * @param {number} offset how many candidates came before this run's first
 * @param {number} total
 * @param {(n: number, of: number) => string} [asking] the sentence for a first request,
 *   `JOB_STEP.asking` when omitted; a revision says `JOB_STEP.revising`
 */
export function generationStepText({ index, kind }, offset, total, asking = JOB_STEP.asking) {
  const n = offset + index + 1;
  if (kind === GENERATION_STEP.asking) return asking(n, total);
  if (kind === GENERATION_STEP.repairing) return JOB_STEP.repairing(n);
  return JOB_STEP.busy;
}

/**
 * The job that generates `count` candidates for the session's vibe and renders each valid one's
 * excerpt as soon as it is made, before asking for the next, so the owner can hear the first
 * while the rest are made. A first try whose excerpt misses one of its vibe's feature ranges or
 * fails a render check is revised once (decision 0036), and the revision's excerpt rendered,
 * before the next first try. Between requests nothing is in flight at omlx, so a render never
 * shares the event loop with a request's first-token timer. Progress counts first tries: one is
 * done once it is stored and, when valid, rendered, measured and revised. Cancelling the job
 * cancels its own omlx requests too (decision 0092), and a cancel during a render stops the job
 * before its next request. With
 * `explore`, the candidates are explore children of its base (decision 0038), revised like any
 * first try. With `breed`, they are crossover children of its two parents (0058), revised like
 * any first try, and then each valid one, its revision when that changed it, is nudged once at
 * the small step and the nudge rendered. When the sidecar is set up (0042), the prompt's
 * examples are the rated genomes nearest the brief, and each excerpt is embedded after its
 * features; the result says why not when it isn't. Once every candidate is made, the session
 * is ranked by the brief's taste model when it has a current one (0046).
 * @param {App} app
 * @param {{ vibeId: number, sessionId: number, count: number,
 *   explore?: ExploreFrom | undefined, breed?: BreedFrom | undefined }} request
 * @returns {(job: JobContext) => Promise<CandidateJobResult>}
 */
export function candidateJob(app, { vibeId, sessionId, count, explore, breed }) {
  return async (job) => {
    const recordings = await jobRecordings(app);
    const playable = playableHashes(recordings);
    /** @type {CandidateRender[]} */
    const excerpts = [];
    /** @type {number[]} */
    const candidateIds = [];
    let done = 0;
    let firstTries = 0;
    /** @type {Promise<Embedder | string> | undefined} */
    let embedder;
    /** @type {string | null} */
    let notEmbedded = null;
    const queue = ownedBy(app.queue, job.signal);
    const cancelRequests = () => queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);

    /**
     * Renders the candidate's excerpt when it has a genome, saying `step` first.
     * @param {Candidate} candidate
     * @param {string} step
     */
    const render = async (candidate, step) => {
      const request = excerptRequest(app.store, candidate);
      if (!request) return null;
      job.progress(done, count, step);
      job.signal.throwIfAborted();
      const { render } = await renderExcerpt(app.store, app.paths.renderCache, request, recordings);
      excerpts.push({ candidateId: candidate.id, renderId: render.id });
      await embed(render);
      return render;
    };

    // The sidecar is asked whether it is set up once, before the first request, and never
    // fetches the checkpoint.
    const readyEmbedder = () =>
      (embedder ??= readEmbedder(app, { fetch: false, signal: job.signal }));

    /**
     * Embeds the excerpt unless it has an embedding under the sidecar's producer.
     * @param {Render} render
     */
    const embed = async (render) => {
      const ready = await readyEmbedder();
      if (typeof ready === "string") {
        if (notEmbedded === null) app.log(`candidates job: ${ready}`);
        notEmbedded = ready;
        return;
      }
      const source = { ratedAudioId: null, renderId: render.id };
      if (findEmbedding(app.store, source, ready.producer)) return;
      job.progress(done, count, JOB_STEP.embeddingCandidate(done + 1, count));
      job.signal.throwIfAborted();
      const file = join(app.paths.renderCache, render.file);
      await embedAudio(app, ready, source, file, job.signal);
    };

    try {
      // A cancel while the folder was indexed fired before the listener was added.
      job.signal.throwIfAborted();
      const seed = Math.floor(app.random() * STREAM_SEEDS);
      const revisions = revisedGroupName(
        requestGroupName(vibeId, seed, batchOperator(explore, breed)),
      );
      const asking = explore ? JOB_STEP.exploring : breed ? JOB_STEP.breeding : JOB_STEP.asking;

      /**
       * Measures the first try's excerpt and revises the first try when it misses anything.
       * Returns the candidate to carry on from: the revision when it changed the first try and
       * became a genome, the first try otherwise.
       * @param {Candidate} firstTry
       * @param {Render} rendered
       * @param {number} index
       * @returns {Promise<Candidate>}
       */
      const measureAndRevise = async (firstTry, rendered, index) => {
        job.progress(done, count, JOB_STEP.measuring(done + 1, count));
        const revision = getRevision(app.store, firstTry.vibeRevisionId);
        if (!revision) throw new Error(`there is no vibe revision ${firstTry.vibeRevisionId}`);
        const features = /** @type {Features} */ (rendered.features);
        const checks = /** @type {LintResult} */ (rendered.checks);
        const misses = excerptMisses(features, checks, checkRevision(revision).ranges);
        if (misses.length === 0) return firstTry;
        job.signal.throwIfAborted();
        let carried = firstTry;
        await reviseCandidate(app.store, queue, firstTry, {
          config: app.config,
          sessionId,
          requestGroup: revisions,
          index,
          seed: revisionSeed(seed, index),
          locks: locksInForce(app.store, vibeId),
          playable,
          features,
          misses,
          control: false,
          onStep: (step) =>
            job.progress(done, count, generationStepText(step, 0, count, JOB_STEP.revising)),
          onCandidate: async (revised) => {
            candidateIds.push(revised.id);
            if (isUnchanged(revised)) return;
            if (await render(revised, JOB_STEP.renderingRevision(done + 1, count))) {
              carried = revised;
            }
          },
        });
        return carried;
      };

      /**
       * Nudges a breed's child once (decision 0058) under the live locks and the revision it
       * was made under, stores every draw, and renders the mutation when one passed.
       * @param {Candidate} child with a genome
       * @param {number} index the crossover child's, from 0
       */
      const mutate = async (child, index) => {
        const revision = getRevision(app.store, child.vibeRevisionId);
        if (!revision) throw new Error(`there is no vibe revision ${child.vibeRevisionId}`);
        const row = getGenome(app.store, /** @type {number} */ (child.genomeId));
        if (!row) throw new Error(`candidate ${child.id} has no genome row`);
        const locks = locksInForce(app.store, vibeId);
        const drawSeed = mutationSeed(seed, index);
        const draws = mutateChild({
          child: row.genome,
          childId: child.id,
          locks,
          constraints: checkRevision(revision).constraints,
          seed: drawSeed,
        });
        const batch = {
          store: app.store,
          vibeId,
          vibeRevisionId: child.vibeRevisionId,
          sessionId,
          locks,
        };
        // A mutation keeps its child's seed, as a nudge child keeps its base's.
        const origin = {
          seed: child.seed,
          source: BREED_SOURCE,
          parentIds: [child.id],
          operator: BREED_OPERATOR,
          operatorParams: { stage: BREED_STAGE.mutation, stepSize: MUTATION_STEP, seed: drawSeed },
        };
        /** @type {Candidate | null} */
        let mutation = null;
        for (const draw of draws) {
          const candidate = keep(batch, null, verdictOf(draw), origin);
          candidateIds.push(candidate.id);
          if (draw.genome) mutation = candidate;
        }
        if (mutation) await render(mutation, JOB_STEP.renderingMutation(done + 1, count));
      };

      const ready = await readyEmbedder();
      const textEmbedder =
        typeof ready === "string"
          ? null
          : {
              producer: ready.producer,
              // A cache hit sends no sidecar request, so check the cancel here before omlx.
              embedText: async (/** @type {string} */ text, /** @type {string} */ what) => {
                const vector = await embedText(app, ready, text, what, job.signal);
                job.signal.throwIfAborted();
                return vector;
              },
            };
      const generated = await generateCandidates(vibeId, count, app.store, queue, {
        config: app.config,
        seed,
        sessionId,
        locks: locksInForce(app.store, vibeId),
        recordings,
        explore,
        breed,
        textEmbedder,
        references: await promptReferences(app.store, vibeId, textEmbedder),
        onStep: (step) => job.progress(done, count, generationStepText(step, 0, count, asking)),
        onCandidate: async (candidate) => {
          const index = firstTries++;
          candidateIds.push(candidate.id);
          const rendered = await render(candidate, JOB_STEP.renderingCandidate(done + 1, count));
          if (rendered) {
            const carried = await measureAndRevise(candidate, rendered, index);
            if (breed) {
              job.signal.throwIfAborted();
              await mutate(carried, index);
            }
          }
          job.progress(++done, count, null);
          job.signal.throwIfAborted();
        },
      });
      const { requestGroup, retrievalMethod } = generated;
      app.log(`candidates job: ${requestGroup} chose its examples by ${retrievalMethod}`);
      const { ranked, notRanked } = await rankSession(
        app,
        { id: sessionId, vibeId },
        job.signal,
        () => job.progress(done, count, JOB_STEP.ranking),
      );
      return {
        requestGroup,
        retrievalMethod,
        candidateIds,
        excerpts,
        notEmbedded,
        ranked,
        notRanked,
      };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

/**
 * The job that renders the excerpt of each of `candidates` that has a genome, for one whose
 * cached excerpt was replaced or made by another producer.
 * @param {App} app
 * @param {Candidate[]} candidates
 * @returns {(job: JobContext) => Promise<{ excerpts: CandidateRender[] }>}
 */
export function excerptJob(app, candidates) {
  return async (job) => ({
    excerpts: await renderFor(app, candidates, job, await jobRecordings(app)),
  });
}

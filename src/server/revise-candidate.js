// The revision of a first try whose excerpt missed a feature range or failed a render check
// (decision 0036): one follow-up turn on its round-0 prompt, with the measurements, answered
// through the same parse, lock, validate, lint and repair path as a first try, and stored as its
// own candidate. It runs only inside the owner's candidates job.
/** @import { Config } from "../config/config.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { Finding } from "../domain/lint-result.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { Lock } from "../domain/validate-lock.js" */
/** @import { Batch, CandidateHook, Sampling, StepHook, Verdict } from "./generate-candidates.js" */
/** @import { Candidate, Generation } from "./generation-store.js" */
/** @import { OmlxQueue } from "./omlx-queue.js" */
/** @import { Store } from "./store.js" */
import { ANSWER_KEY } from "../domain/extract-genome.js";
import { followUp } from "../domain/follow-up.js";
import { lintResult } from "../domain/lint-result.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { revisionAsk } from "../domain/revision-ask.js";
import { checkRevision, keep, LLM_SOURCE, requestCandidate } from "./generate-candidates.js";
import { getGeneration, getGenome } from "./generation-store.js";
import { genomeHash } from "./genome-hash.js";
import { getRevision } from "./vibe-store.js";

/** The operator of a revision. */
export const REVISE = "revise";
const REVISION_OVER_BUDGET_RULE = "revisionOverBudget";

/**
 * Whether a revision returned its first try's genome, or was never sent: either way it is not
 * rendered or shown.
 * @param {Candidate} candidate a revision
 */
export const isUnchanged = (candidate) =>
  /** @type {{ unchanged?: boolean } | null} */ (candidate.operatorParams)?.unchanged === true;

/**
 * @typedef {object} ReviseOptions
 * @property {Config} config
 * @property {number | null} sessionId
 * @property {string} requestGroup the job's revisions' group, from `revisedGroupName`
 * @property {number} index the first try's, from 0, for `onStep`
 * @property {number} seed the revision's render seed, from `revisionSeed`
 * @property {readonly Lock[]} locks the vibe's locks in force now: the ask restates them and
 *   every valid answer gets them
 * @property {ReadonlySet<string>} playable from `playableHashes`
 * @property {Features} features the first try's excerpt, measured
 * @property {readonly Finding[]} misses from `excerptMisses`, at least one
 * @property {CandidateHook | undefined} [onCandidate] called as the revision is stored
 * @property {StepHook | undefined} [onStep]
 */

/**
 * The round-0 generation behind a candidate's last one: a repaired first try names its repair.
 * @param {Store} store
 * @param {number} generationId
 * @returns {Generation}
 */
function roundZero(store, generationId) {
  const generation = getGeneration(store, generationId);
  if (!generation) throw new Error(`there is no generation ${generationId}`);
  if (generation.repairsId === null) return generation;
  return roundZero(store, generation.repairsId);
}

/**
 * Revises `firstTry` once and stores the revision with the first try as its parent and operator
 * `revise`. An answer that returns the first try's genome is stored with
 * `operatorParams.unchanged` true, on its genome and seed. A follow-up over the context budget
 * isn't trimmed, since its earlier turns must match what was sent: it isn't sent, and an
 * unchanged revision with a `revisionOverBudget` finding and no generation says so. A request
 * that fails in the queue is rethrown after its rows are stored, as for a first try.
 * @param {Store} store
 * @param {OmlxQueue} queue
 * @param {Candidate} firstTry a valid candidate the model wrote
 * @param {ReviseOptions} options
 * @returns {Promise<Candidate>}
 */
export async function reviseCandidate(store, queue, firstTry, options) {
  const { config, locks, seed, index } = options;
  if (firstTry.genomeId === null || firstTry.generationId === null) {
    throw new Error(`candidate ${firstTry.id} has no genome or no generation to revise`);
  }
  const revision = getRevision(store, firstTry.vibeRevisionId);
  if (!revision) throw new Error(`there is no vibe revision ${firstTry.vibeRevisionId}`);
  const { constraints, ranges } = checkRevision(revision);
  const row = getGenome(store, firstTry.genomeId);
  if (!row) throw new Error(`there is no genome ${firstTry.genomeId}`);
  const first = roundZero(store, firstTry.generationId);
  const answer = { [ANSWER_KEY.intent]: firstTry.intent, [ANSWER_KEY.genome]: row.genome };
  const ask = revisionAsk({ locks, ranges, features: options.features, misses: options.misses });
  const prompt = followUp(/** @type {ChatMessage[]} */ (first.prompt), answer, ask);

  /** @type {Batch} */
  const batch = {
    store,
    queue,
    config,
    vibeId: revision.vibeId,
    vibeRevisionId: firstTry.vibeRevisionId,
    sessionId: options.sessionId,
    requestGroup: options.requestGroup,
    exampleIds: /** @type {number[]} */ (first.exampleIds),
    retrievalMethod: first.retrievalMethod,
    constraints,
    playable: options.playable,
    locks,
    onCandidate: options.onCandidate,
    onStep: options.onStep,
  };
  /** @param {boolean} unchanged */
  const origin = (unchanged) => ({
    seed: unchanged ? firstTry.seed : seed,
    source: LLM_SOURCE,
    parentIds: [firstTry.id],
    operator: REVISE,
    operatorParams: { unchanged },
  });

  const budgetTokens = config.queue.contextBudgetTokens;
  const tokens = estimateTokens(promptText(prompt));
  if (tokens > budgetTokens) {
    const message = `the revision prompt is about ${tokens} tokens, over the ${budgetTokens}-token budget; no revision was sent`;
    /** @type {Verdict} */
    const skipped = {
      reason: null,
      lint: lintResult([{ path: "$", rule: REVISION_OVER_BUDGET_RULE, message }]),
      intent: firstTry.intent,
      genome: row.genome,
      answer: null,
      written: row.genome,
      lockChanges: null,
    };
    const candidate = keep(batch, null, skipped, origin(true));
    await batch.onCandidate?.(candidate, null);
    return candidate;
  }
  return requestCandidate(
    batch,
    index,
    prompt,
    /** @type {Sampling} */ (first.sampling),
    ({ genome }) => origin(genome !== null && genomeHash(genome) === row.genomeHash),
  );
}

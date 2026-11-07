// Asks omlx for n candidate genomes for a vibe (decision 0024): one prompt shared by the n
// requests of a request group, sampling drawn per candidate from a logged stream seed, each
// answer parsed, validated and linted, one repair round for an answer with errors to quote, and
// every generation and candidate stored. It runs only when the owner's route or job calls it.
// The batch helpers (`ask`, `keep`, `failedVerdict`, `requestCandidate`) are what every
// operator that asks the model calls, so all its answers take one path.
/** @import { Config } from "../config/config.js" */
/** @import { Lock } from "../domain/validate-lock.js" */
/** @import { RecordingListing } from "../domain/recordings-text.js" */
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
/** @import { Finding, LintResult } from "../domain/lint-result.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { RejectReason } from "../domain/reject-reason.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Candidate, Generation } from "./generation-store.js" */
/** @import { Completion, OmlxQueue } from "./omlx-queue.js" */
/** @import { Store } from "./store.js" */
/** @import { VibeRevision } from "./vibe-store.js" */
import { applyLocks } from "../domain/apply-locks.js";
import { buildPrompt } from "../domain/build-prompt.js";
import { buildRepairPrompt } from "../domain/build-repair-prompt.js";
import { ANSWER_KEY, extractGenome } from "../domain/extract-genome.js";
import { lintGenome } from "../domain/lint-genome.js";
import { lintResult } from "../domain/lint-result.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { REJECT_REASON } from "../domain/reject-reason.js";
import { validateConstraints } from "../domain/validate-constraints.js";
import { validateTargets } from "../domain/validate-targets.js";
import { unplayable } from "../engine/field-recording.js";
import { drawer } from "../engine/prng.js";
import { recordingRefs } from "../engine/recording-refs.js";
import { validateGenome } from "../engine/validate-genome.js";
import { addCandidate, addGeneration, listRequestGroup, putGenome } from "./generation-store.js";
import { OmlxRequestError } from "./omlx-queue.js";
import { retrieveExamples } from "./retrieve-examples.js";
import { getVibe, listNotes } from "./vibe-store.js";

/**
 * The key the sampling stream draws under. It doesn't match a voice id, so a draw here never
 * shares a key with a render's (decision 0003).
 */
const STREAM_ID = ":generation";
/** The stream's draws for candidate i are `(seed, STREAM_ID, i, slot)`. */
const SLOT = Object.freeze({ temperature: 0, samplingSeed: 1, candidateSeed: 2 });
const TEMPERATURE = Object.freeze({ min: 0.6, max: 1 });
const TOP_P = 0.95;
/** omlx takes a signed 32-bit sampling seed; candidate seeds use the PRNG's full range. */
const SAMPLING_SEEDS = 2 ** 31;
const CANDIDATE_SEEDS = 2 ** 32;

const SOURCE = "llm";
/** The rule a finding takes for a validator error, and for an answer-shape error. */
const SCHEMA_RULE = "schema";
const ANSWER_RULE = "answer";
const REPAIR_OVER_BUDGET_RULE = "repairOverBudget";
const REPAIR_NOT_SENT_RULE = "repairNotSent";
const UNLISTED_RECORDING = "no recording in the folder has this sha256; use one from the list";
/** The finish reason of a generation whose request failed in the queue (migration 0002). */
const FAILED_FINISH = "error";

/** The answer's JSON schema, sent as `response_format` when the config asks for it (0022). */
const RESPONSE_FORMAT = Object.freeze({
  name: "genome_answer",
  schema: {
    type: "object",
    properties: {
      [ANSWER_KEY.intent]: { type: "string" },
      [ANSWER_KEY.genome]: { type: "object" },
    },
    required: [ANSWER_KEY.intent, ANSWER_KEY.genome],
    additionalProperties: false,
  },
});

/**
 * The request group of a vibe's candidates drawn from one stream seed (decision 0024): named
 * per vibe, so one seed can serve several vibes, and refused when it exists.
 * @param {number} vibeId
 * @param {number} seed
 */
export const requestGroupName = (vibeId, seed) => `vibe-${vibeId}-stream-${seed}`;

/** @typedef {{ temperature: number, top_p: number, seed: number }} Sampling */

/**
 * What one response came to. `answer` is set when there are errors to quote in a repair.
 * @typedef {object} Verdict
 * @property {RejectReason | null} reason
 * @property {LintResult} lint every reason, as findings
 * @property {string | null} intent
 * @property {Genome | null} genome the valid genome; null when rejected
 * @property {Record<string, unknown> | null} answer
 * @property {unknown} written the genome as the answer wrote it; null when none parsed
 * @property {{ locksChanged: string[], locksFilled: string[] } | null} lockChanges the lock
 *   paths the answer changed and left out, which `applyLocks` restored; null when the genome
 *   was rejected or no lock was in force
 */

/**
 * @typedef {object} GenerateOptions
 * @property {Config} config
 * @property {number} seed the stream seed, an integer in [0, 2^32): sampling and candidate seeds
 *   are drawn from it, and it names the request group, so each value is used once
 * @property {number | null} sessionId
 * @property {readonly Lock[]} locks written into every valid answer and stored on each
 *   candidate: the session's job passes the vibe's live locks, the evaluation none (decision
 *   0035)
 * @property {readonly RecordingListing[]} recordings the recordings folder's index, empty when the
 *   config sets no folder: the prompt lists them, and a genome naming another is repaired
 * @property {(candidate: Candidate, firstReason: RejectReason | null) => void | Promise<void>} [onCandidate]
 *   called as each candidate is stored, with the reason its first answer was rejected (null when
 *   it was valid), which the candidate row no longer holds once a repair replaced it. The next
 *   request waits for it, so a job can render the candidate before asking for another.
 * @property {(step: GenerationStep) => void} [onStep] called as each request is queued, and as
 *   omlx answers one busy
 */

/** What generation is doing for a candidate: its first request, its repair, or a backoff. */
export const GENERATION_STEP = Object.freeze({
  asking: "asking",
  repairing: "repairing",
  busy: "busy",
});

/**
 * What generation is doing for candidate `index` (from 0).
 * @typedef {{ index: number, kind: (typeof GENERATION_STEP)[keyof typeof GENERATION_STEP] }} GenerationStep
 */

/**
 * @param {number} seed
 * @param {number} count
 */
function samplingStream(seed, count) {
  const draw = drawer(seed, STREAM_ID);
  return Array.from({ length: count }, (_, i) => {
    const t = TEMPERATURE.min + (TEMPERATURE.max - TEMPERATURE.min) * draw(i, SLOT.temperature);
    /** @type {Sampling} */
    const sampling = {
      temperature: Math.round(t * 100) / 100,
      top_p: TOP_P,
      seed: Math.floor(draw(i, SLOT.samplingSeed) * SAMPLING_SEEDS),
    };
    return { sampling, candidateSeed: Math.floor(draw(i, SLOT.candidateSeed) * CANDIDATE_SEEDS) };
  });
}

/**
 * @param {RejectReason} reason
 * @param {Finding[]} findings
 * @param {Partial<Verdict>} [rest]
 * @returns {Verdict}
 */
const rejected = (reason, findings, rest = {}) => ({
  reason,
  lint: lintResult(findings),
  intent: null,
  genome: null,
  answer: null,
  written: null,
  lockChanges: null,
  ...rest,
});

/**
 * @param {Completion} completion
 * @param {Constraints} constraints
 * @param {number} maxTokens
 * @param {ReadonlySet<string>} playable hashes of the recordings the voice can play
 * @param {readonly Lock[]} locks
 * @returns {Verdict}
 */
function judge(completion, constraints, maxTokens, playable, locks) {
  if (completion.finishReason === "length") {
    const message = `the answer hit max_tokens (${maxTokens}) and was cut off`;
    return rejected(REJECT_REASON.truncated, [
      { path: "$", rule: REJECT_REASON.truncated, message },
    ]);
  }
  const extracted = extractGenome(completion.text);
  if (!extracted.ok) {
    const { reason, message } = extracted;
    return rejected(reason, [{ path: "$", rule: reason, message }]);
  }
  const { answer, intent, genome, errors } = extracted;
  const validated = genome === undefined ? null : validateGenome(genome);
  // Locked values go in before the recordings are checked and the genome linted, so both see
  // the genome that would be stored (decision 0035).
  const locked = validated?.ok ? applyLocks(validated.genome, locks, genome) : null;
  const schemaFindings = [
    ...errors.map((e) => ({ ...e, rule: ANSWER_RULE })),
    ...(validated && !validated.ok
      ? validated.errors.map((e) => ({ ...e, rule: SCHEMA_RULE }))
      : []),
    // A hash the model made up or misspelled would render only to fail, so it is repaired here.
    ...(locked
      ? recordingRefs(locked.genome)
          .filter(({ hash }) => !playable.has(hash))
          .map(({ path }) => ({ path, rule: SCHEMA_RULE, message: UNLISTED_RECORDING }))
      : []),
  ];
  if (schemaFindings.length > 0 || !locked) {
    const written = genome ?? null;
    const findings = [...schemaFindings, ...(locked?.findings ?? [])];
    return rejected(REJECT_REASON.schemaErrors, findings, { intent, answer, written });
  }
  const linted = lintGenome(locked.genome, constraints);
  // A lock the answer can't take is a lint finding, so the repair round gets it.
  const lint = lintResult([...locked.findings, ...linted.findings]);
  if (!lint.ok)
    return rejected(REJECT_REASON.lintErrors, lint.findings, { intent, answer, written: genome });
  const lockChanges =
    locks.length === 0 ? null : { locksChanged: locked.changed, locksFilled: locked.filled };
  return {
    reason: null,
    lint,
    intent,
    genome: locked.genome,
    answer: null,
    written: genome,
    lockChanges,
  };
}

/**
 * The vibe's current revision with its constraints and feature ranges checked. Throws when the
 * vibe is missing or removed, or either fails its validator, since every prompt states both.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {{ revision: VibeRevision, constraints: Constraints, ranges: FeatureRanges }}
 */
export function currentRevision(store, vibeId) {
  const vibe = getVibe(store, vibeId);
  if (!vibe || vibe.removedAt !== null)
    throw new Error(`vibe ${vibeId} doesn't exist or was removed`);
  const { revision } = vibe;
  const checked = validateConstraints(revision.constraints);
  if (!checked.ok) {
    const list = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`vibe ${vibeId} revision ${revision.id} has invalid constraints: ${list}`);
  }
  const targets = validateTargets(revision.softTargets);
  if (!targets.ok) {
    const list = targets.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`vibe ${vibeId} revision ${revision.id} has invalid soft targets: ${list}`);
  }
  return { revision, constraints: checked.constraints, ranges: targets.ranges };
}

/**
 * What the requests and candidates of one batch share: one request group, one prompt's
 * retrieval, and the locks written into every valid answer. An operator builds one per request
 * group and passes it to `ask`, `keep` and `requestCandidate`.
 * @typedef {object} Batch
 * @property {Store} store
 * @property {OmlxQueue} queue
 * @property {Config} config
 * @property {number} vibeId
 * @property {number} vibeRevisionId
 * @property {number | null} sessionId
 * @property {string} requestGroup
 * @property {number[]} exampleIds the examples in the prompt, logged with each generation
 * @property {string} retrievalMethod
 * @property {Constraints} constraints what each answer is linted against
 * @property {ReadonlySet<string>} playable hashes of the recordings the voice can play; a genome
 *   naming another is repaired
 * @property {readonly Lock[]} locks applied to every valid answer and stored on each candidate
 * @property {GenerateOptions["onCandidate"]} [onCandidate]
 * @property {GenerateOptions["onStep"]} [onStep]
 */

/**
 * Where a candidate came from, stored on its row. `operatorParams` is merged over the locks the
 * answer changed and left out, and the row's is null when both are.
 * @typedef {object} CandidateOrigin
 * @property {number} seed the candidate's render seed
 * @property {string} source
 * @property {number[]} parentIds
 * @property {string | null} operator null for a root
 * @property {Record<string, unknown> | null} operatorParams
 */

/**
 * Sends one request and stores it as a generation, with the answer parsed, locked, validated and
 * linted into a verdict. A failure the queue sent at least one attempt for is stored with its
 * error; one it never sent leaves no generation.
 * @param {Batch} batch
 * @param {number} index the candidate's, from 0, for `onStep`
 * @param {ChatMessage[]} prompt
 * @param {Sampling} sampling
 * @param {number | null} repairsId the generation this request repairs; null for a first try
 * @returns {Promise<
 *   | { generation: Generation, verdict: Verdict, failure: null }
 *   | { generation: Generation | null, verdict: null, failure: OmlxRequestError }
 * >}
 */
export async function ask(batch, index, prompt, sampling, repairsId) {
  const { store, queue, config, onStep } = batch;
  const base = {
    vibeRevisionId: batch.vibeRevisionId,
    sessionId: batch.sessionId,
    requestGroup: batch.requestGroup,
    prompt,
    exampleIds: batch.exampleIds,
    retrievalMethod: batch.retrievalMethod,
    model: config.omlx.model,
    sampling,
    repairRound: repairsId === null ? 0 : 1,
    repairsId,
  };
  /** @type {Completion} */
  let completion;
  onStep?.({
    index,
    kind: repairsId === null ? GENERATION_STEP.asking : GENERATION_STEP.repairing,
  });
  try {
    completion = await queue.request({
      messages: prompt,
      sampling,
      responseFormat: RESPONSE_FORMAT,
      onRetry: () => onStep?.({ index, kind: GENERATION_STEP.busy }),
    });
  } catch (error) {
    if (!(error instanceof OmlxRequestError)) throw error;
    if (error.latencyMs === null) return { generation: null, verdict: null, failure: error };
    const generation = addGeneration(store, {
      ...base,
      response: "",
      finishReason: FAILED_FINISH,
      latencyMs: error.latencyMs,
      firstTokenMs: null,
      promptTokens: null,
      completionTokens: null,
      reasoning: null,
      requestParams: error.params,
      retries: error.retries,
      error: error.message,
    });
    return { generation, verdict: null, failure: error };
  }
  const generation = addGeneration(store, {
    ...base,
    response: completion.text,
    finishReason: completion.finishReason,
    latencyMs: completion.latencyMs,
    firstTokenMs: completion.firstTokenMs,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    reasoning: completion.reasoning === "" ? null : completion.reasoning,
    requestParams: completion.params,
    retries: completion.retries,
    error: null,
  });
  const verdict = judge(
    completion,
    batch.constraints,
    config.queue.maxTokens,
    batch.playable,
    batch.locks,
  );
  return { generation, verdict, failure: null };
}

/**
 * Stores a verdict as a candidate, and its genome when it has one.
 * @param {Batch} batch
 * @param {Generation | null} generation the last generation made for the candidate; null for
 *   one no LLM call made
 * @param {Verdict} verdict
 * @param {CandidateOrigin} origin
 * @returns {Candidate}
 */
export function keep(batch, generation, verdict, origin) {
  const { store } = batch;
  const genomeId =
    verdict.genome === null ? null : putGenome(store, batch.vibeId, verdict.genome).id;
  const operatorParams =
    verdict.lockChanges === null && origin.operatorParams === null
      ? null
      : { ...verdict.lockChanges, ...origin.operatorParams };
  return addCandidate(store, {
    vibeRevisionId: batch.vibeRevisionId,
    generationId: generation?.id ?? null,
    genomeId,
    seed: origin.seed,
    source: origin.source,
    parentIds: origin.parentIds,
    locks: batch.locks,
    operator: origin.operator,
    operatorParams,
    intent: verdict.intent,
    rejectReason: verdict.reason,
    lint: verdict.lint,
    rejectedGenome: verdict.reason === null ? null : verdict.written,
  });
}

/**
 * The verdict for a candidate whose last request failed, keeping what an earlier try found.
 * @param {OmlxRequestError} failure
 * @param {Verdict | null} earlier
 * @returns {Verdict}
 */
export function failedVerdict(failure, earlier) {
  const finding = { path: "$", rule: REJECT_REASON.requestFailed, message: failure.message };
  return rejected(REJECT_REASON.requestFailed, [...(earlier?.lint.findings ?? []), finding], {
    intent: earlier?.intent ?? null,
    written: earlier?.written ?? null,
  });
}

/**
 * @param {Verdict} verdict
 * @param {string} rule
 * @param {string} message
 * @returns {Verdict}
 */
const noted = (verdict, rule, message) => ({
  ...verdict,
  lint: lintResult([...verdict.lint.findings, { path: "$", rule, message }]),
});

/**
 * Asks for one candidate with `prompt`, sends one repair round for an answer with errors to
 * quote, stores the candidate and calls `batch.onCandidate`. When a request fails in the queue
 * it rethrows the failure after storing the candidate it was for, so every generation has one.
 * @param {Batch} batch
 * @param {number} index the candidate's, from 0, for `onStep`
 * @param {ChatMessage[]} prompt
 * @param {Sampling} sampling used by the first try and its repair
 * @param {CandidateOrigin} origin
 * @returns {Promise<Candidate>}
 */
export async function requestCandidate(batch, index, prompt, sampling, origin) {
  /**
   * @param {Generation} generation
   * @param {Verdict} verdict
   * @param {RejectReason | null} firstReason
   */
  const stored = async (generation, verdict, firstReason) => {
    const candidate = keep(batch, generation, verdict, origin);
    await batch.onCandidate?.(candidate, firstReason);
    return candidate;
  };
  const first = await ask(batch, index, prompt, sampling, null);
  if (first.failure !== null) {
    if (first.generation)
      await stored(
        first.generation,
        failedVerdict(first.failure, null),
        REJECT_REASON.requestFailed,
      );
    throw first.failure;
  }
  let { generation, verdict } = first;
  const firstReason = verdict.reason;
  if (verdict.answer !== null) {
    const budgetTokens = batch.config.queue.contextBudgetTokens;
    const repair = buildRepairPrompt(
      { messages: prompt, answer: verdict.answer },
      verdict.lint.findings,
    );
    const tokens = estimateTokens(promptText(repair));
    if (tokens > budgetTokens) {
      const message = `the repair prompt is about ${tokens} tokens, over the ${budgetTokens}-token budget; no repair was sent`;
      verdict = noted(verdict, REPAIR_OVER_BUDGET_RULE, message);
    } else {
      const repaired = await ask(batch, index, repair, sampling, generation.id);
      if (repaired.failure !== null) {
        if (repaired.generation) {
          await stored(repaired.generation, failedVerdict(repaired.failure, verdict), firstReason);
        } else {
          const message = `the repair was not sent: ${repaired.failure.message}`;
          await stored(generation, noted(verdict, REPAIR_NOT_SENT_RULE, message), firstReason);
        }
        throw repaired.failure;
      }
      ({ generation, verdict } = repaired);
    }
  }
  return stored(generation, verdict, firstReason);
}

/**
 * Generates `n` candidates for the vibe's current revision and stores every LLM call and every
 * candidate. When a request fails in the queue (a cancel, a busy omlx past its wait, a timeout,
 * an error status) the batch stops and rethrows it, after storing the failed request as a
 * generation, if it was sent, and the candidate it was for, so every generation has a candidate.
 * @param {number} vibeId
 * @param {number} n
 * @param {Store} store
 * @param {OmlxQueue} queue
 * @param {GenerateOptions} options
 * @returns {Promise<{ requestGroup: string, candidates: Candidate[] }>}
 */
export async function generateCandidates(
  vibeId,
  n,
  store,
  queue,
  { config, seed, sessionId, locks, recordings, onCandidate, onStep },
) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n must be a positive integer, got ${n}`);
  const { revision, constraints, ranges } = currentRevision(store, vibeId);
  const draws = samplingStream(seed, n);
  const requestGroup = requestGroupName(vibeId, seed);
  if (listRequestGroup(store, requestGroup).length > 0) {
    throw new Error(`request group ${requestGroup} already exists; draw a new stream seed`);
  }
  const { method, examples } = retrieveExamples(store, vibeId);
  const { messages, exampleIds } = buildPrompt(
    { ...revision, constraints, ranges },
    {
      notes: listNotes(store, vibeId).map((note) => note.text),
      locks,
      examples,
      budgetTokens: config.queue.contextBudgetTokens,
      recordings,
    },
  );
  /** @type {Batch} */
  const batch = {
    store,
    queue,
    config,
    vibeId,
    vibeRevisionId: revision.id,
    sessionId,
    requestGroup,
    exampleIds,
    retrievalMethod: method,
    constraints,
    playable: new Set(recordings.filter((r) => unplayable(r) === null).map((r) => r.hash)),
    locks,
    onCandidate,
    onStep,
  };
  /** @type {Candidate[]} */
  const candidates = [];
  for (const [index, { sampling, candidateSeed }] of draws.entries()) {
    const origin = {
      seed: candidateSeed,
      source: SOURCE,
      parentIds: [],
      operator: null,
      operatorParams: null,
    };
    candidates.push(await requestCandidate(batch, index, messages, sampling, origin));
  }
  return { requestGroup, candidates };
}

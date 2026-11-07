// Asks omlx for n candidate genomes for a vibe (decision 0024): one prompt shared by the n
// requests of a request group, sampling drawn per candidate from a logged stream seed, each
// answer parsed, validated and linted, one repair round for an answer with errors to quote, and
// every generation and candidate stored. It runs only when the owner's route or job calls it.
/** @import { Config } from "../config/config.js" */
/** @import { Lock } from "../domain/build-prompt.js" */
/** @import { RecordingListing } from "../domain/recordings-text.js" */
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { Finding, LintResult } from "../domain/lint-result.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { RejectReason } from "../domain/reject-reason.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Candidate, Generation } from "./generation-store.js" */
/** @import { Completion, OmlxQueue } from "./omlx-queue.js" */

/** @import { Store } from "./store.js" */
import { buildPrompt } from "../domain/build-prompt.js";
import { buildRepairPrompt } from "../domain/build-repair-prompt.js";
import { ANSWER_KEY, extractGenome } from "../domain/extract-genome.js";
import { lintGenome } from "../domain/lint-genome.js";
import { lintResult } from "../domain/lint-result.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { REJECT_REASON } from "../domain/reject-reason.js";
import { validateConstraints } from "../domain/validate-constraints.js";
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
 */

/**
 * @typedef {object} GenerateOptions
 * @property {Config} config
 * @property {number} seed the stream seed, an integer in [0, 2^32): sampling and candidate seeds
 *   are drawn from it, and it names the request group, so each value is used once
 * @property {number | null} sessionId
 * @property {Lock[]} locks
 * @property {readonly RecordingListing[]} recordings the recordings folder's index, empty when the
 *   config sets no folder: the prompt lists them, and a genome naming another is repaired
 * @property {(candidate: Candidate, firstReason: RejectReason | null) => void} [onCandidate]
 *   called as each candidate is stored, with the reason its first answer was rejected (null when
 *   it was valid), which the candidate row no longer holds once a repair replaced it
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
  ...rest,
});

/**
 * @param {Completion} completion
 * @param {Constraints} constraints
 * @param {number} maxTokens
 * @param {ReadonlySet<string>} playable hashes of the recordings the voice can play
 * @returns {Verdict}
 */
function judge(completion, constraints, maxTokens, playable) {
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
  const schemaFindings = [
    ...errors.map((e) => ({ ...e, rule: ANSWER_RULE })),
    ...(validated && !validated.ok
      ? validated.errors.map((e) => ({ ...e, rule: SCHEMA_RULE }))
      : []),
    // A hash the model made up or misspelled would render only to fail, so it is repaired here.
    ...(validated?.ok
      ? recordingRefs(validated.genome)
          .filter(({ hash }) => !playable.has(hash))
          .map(({ path }) => ({ path, rule: SCHEMA_RULE, message: UNLISTED_RECORDING }))
      : []),
  ];
  if (schemaFindings.length > 0 || !validated?.ok) {
    const written = genome ?? null;
    return rejected(REJECT_REASON.schemaErrors, schemaFindings, { intent, answer, written });
  }
  const lint = lintGenome(validated.genome, constraints);
  if (!lint.ok) {
    return {
      reason: REJECT_REASON.lintErrors,
      lint,
      intent,
      genome: null,
      answer,
      written: genome,
    };
  }
  return { reason: null, lint, intent, genome: validated.genome, answer: null, written: genome };
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
  { config, seed, sessionId, locks, recordings, onCandidate },
) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n must be a positive integer, got ${n}`);
  const vibe = getVibe(store, vibeId);
  if (!vibe || vibe.removedAt !== null)
    throw new Error(`vibe ${vibeId} doesn't exist or was removed`);
  const { revision } = vibe;
  const checked = validateConstraints(revision.constraints);
  if (!checked.ok) {
    const list = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`vibe ${vibeId} revision ${revision.id} has invalid constraints: ${list}`);
  }
  const { constraints } = checked;
  const draws = samplingStream(seed, n);
  const requestGroup = requestGroupName(vibeId, seed);
  if (listRequestGroup(store, requestGroup).length > 0) {
    throw new Error(`request group ${requestGroup} already exists; draw a new stream seed`);
  }
  const { method, examples } = retrieveExamples(store, vibeId);
  const budgetTokens = config.queue.contextBudgetTokens;
  const playable = new Set(recordings.filter((r) => unplayable(r) === null).map((r) => r.hash));
  const { messages, exampleIds } = buildPrompt(
    { ...revision, constraints },
    {
      notes: listNotes(store, vibeId).map((note) => note.text),
      locks,
      examples,
      budgetTokens,
      recordings,
    },
  );

  /**
   * Sends one request and stores it as a generation. A failure the queue sent at least one
   * attempt for is stored with its error; one it never sent leaves no generation.
   * @param {ChatMessage[]} prompt
   * @param {Sampling} sampling
   * @param {number | null} repairsId
   * @returns {Promise<
   *   | { generation: Generation, verdict: Verdict, failure: null }
   *   | { generation: Generation | null, verdict: null, failure: OmlxRequestError }
   * >}
   */
  async function ask(prompt, sampling, repairsId) {
    const base = {
      vibeRevisionId: revision.id,
      sessionId,
      requestGroup,
      prompt,
      exampleIds,
      retrievalMethod: method,
      model: config.omlx.model,
      sampling,
      repairRound: repairsId === null ? 0 : 1,
      repairsId,
    };
    /** @type {Completion} */
    let completion;
    try {
      completion = await queue.request({
        messages: prompt,
        sampling,
        responseFormat: RESPONSE_FORMAT,
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
    const verdict = judge(completion, constraints, config.queue.maxTokens, playable);
    return { generation, verdict, failure: null };
  }

  /** @type {Candidate[]} */
  const candidates = [];
  /**
   * @param {Generation} generation the last generation made for the candidate
   * @param {Verdict} verdict
   * @param {number} candidateSeed
   * @param {RejectReason | null} firstReason
   */
  const keep = (generation, verdict, candidateSeed, firstReason) => {
    const genomeId = verdict.genome === null ? null : putGenome(store, vibeId, verdict.genome).id;
    const candidate = addCandidate(store, {
      vibeRevisionId: revision.id,
      generationId: generation.id,
      genomeId,
      seed: candidateSeed,
      source: SOURCE,
      parentIds: [],
      locks,
      operator: null,
      operatorParams: null,
      intent: verdict.intent,
      rejectReason: verdict.reason,
      lint: verdict.lint,
      rejectedGenome: verdict.reason === null ? null : verdict.written,
    });
    candidates.push(candidate);
    onCandidate?.(candidate, firstReason);
  };
  /**
   * The verdict for a candidate whose last request failed, keeping what an earlier try found.
   * @param {OmlxRequestError} failure
   * @param {Verdict | null} earlier
   * @returns {Verdict}
   */
  const failedVerdict = (failure, earlier) => {
    const finding = { path: "$", rule: REJECT_REASON.requestFailed, message: failure.message };
    return rejected(REJECT_REASON.requestFailed, [...(earlier?.lint.findings ?? []), finding], {
      intent: earlier?.intent ?? null,
      written: earlier?.written ?? null,
    });
  };
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

  for (const { sampling, candidateSeed } of draws) {
    const first = await ask(messages, sampling, null);
    if (first.failure !== null) {
      if (first.generation)
        keep(
          first.generation,
          failedVerdict(first.failure, null),
          candidateSeed,
          REJECT_REASON.requestFailed,
        );
      throw first.failure;
    }
    let { generation, verdict } = first;
    const firstReason = verdict.reason;
    if (verdict.answer !== null) {
      const repair = buildRepairPrompt({ messages, answer: verdict.answer }, verdict.lint.findings);
      const tokens = estimateTokens(promptText(repair));
      if (tokens > budgetTokens) {
        const message = `the repair prompt is about ${tokens} tokens, over the ${budgetTokens}-token budget; no repair was sent`;
        verdict = noted(verdict, REPAIR_OVER_BUDGET_RULE, message);
      } else {
        const repaired = await ask(repair, sampling, generation.id);
        if (repaired.failure !== null) {
          if (repaired.generation) {
            keep(
              repaired.generation,
              failedVerdict(repaired.failure, verdict),
              candidateSeed,
              firstReason,
            );
          } else {
            const message = `the repair was not sent: ${repaired.failure.message}`;
            keep(
              generation,
              noted(verdict, REPAIR_NOT_SENT_RULE, message),
              candidateSeed,
              firstReason,
            );
          }
          throw repaired.failure;
        }
        ({ generation, verdict } = repaired);
      }
    }
    keep(generation, verdict, candidateSeed, firstReason);
  }
  return { requestGroup, candidates };
}

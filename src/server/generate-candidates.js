// Asks omlx for n candidate genomes for a vibe (decision 0024): one prompt shared by the n
// requests of a request group, sampling drawn per candidate from a logged stream seed, each
// answer parsed, validated and linted, one repair round for an answer with errors to quote, and
// every generation and candidate stored. It runs only when the owner's route or job calls it.
/** @import { Config } from "../config/config.js" */
/** @import { Lock } from "../domain/build-prompt.js" */
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
import { drawer } from "../engine/prng.js";
import { validateGenome } from "../engine/validate-genome.js";
import { addCandidate, addGeneration, listRequestGroup, putGenome } from "./generation-store.js";
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

/** @typedef {{ temperature: number, top_p: number, seed: number }} Sampling */

/**
 * What one response came to. `answer` is set when there are errors to quote in a repair.
 * @typedef {object} Verdict
 * @property {RejectReason | null} reason
 * @property {LintResult} lint every reason, as findings
 * @property {string | null} intent
 * @property {Genome | null} genome the valid genome; null when rejected
 * @property {Record<string, unknown> | null} answer
 */

/**
 * @typedef {object} GenerateOptions
 * @property {Config} config
 * @property {number} seed the stream seed, an integer in [0, 2^32): sampling and candidate seeds
 *   are drawn from it, and it names the request group, so each value is used once
 * @property {number | null} sessionId
 * @property {Lock[]} locks
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
  ...rest,
});

/**
 * @param {Completion} completion
 * @param {Constraints} constraints
 * @param {number} maxTokens
 * @returns {Verdict}
 */
function judge(completion, constraints, maxTokens) {
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
  ];
  if (schemaFindings.length > 0 || !validated?.ok) {
    return rejected(REJECT_REASON.schemaErrors, schemaFindings, { intent, answer });
  }
  const lint = lintGenome(validated.genome, constraints);
  if (!lint.ok) return { reason: REJECT_REASON.lintErrors, lint, intent, genome: null, answer };
  return { reason: null, lint, intent, genome: validated.genome, answer: null };
}

/**
 * Generates `n` candidates for the vibe's current revision and stores every LLM call and every
 * candidate. Rejects when the queue does (a cancel, a busy omlx past its wait); what was stored
 * before stays.
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
  { config, seed, sessionId, locks },
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
  const requestGroup = `stream-${seed}`;
  if (listRequestGroup(store, requestGroup).length > 0) {
    throw new Error(`request group ${requestGroup} already exists; draw a new stream seed`);
  }
  const { method, examples } = retrieveExamples(store, vibeId);
  const budgetTokens = config.queue.contextBudgetTokens;
  const { messages, exampleIds } = buildPrompt(
    { ...revision, constraints },
    {
      notes: listNotes(store, vibeId).map((note) => note.text),
      locks,
      examples,
      budgetTokens,
    },
  );

  /**
   * @param {ChatMessage[]} prompt
   * @param {Sampling} sampling
   * @param {number | null} repairsId
   * @returns {Promise<{ generation: Generation, verdict: Verdict }>}
   */
  async function ask(prompt, sampling, repairsId) {
    const completion = await queue.request({
      messages: prompt,
      sampling,
      responseFormat: RESPONSE_FORMAT,
    });
    const generation = addGeneration(store, {
      vibeRevisionId: revision.id,
      sessionId,
      requestGroup,
      prompt,
      exampleIds,
      retrievalMethod: method,
      model: config.omlx.model,
      sampling,
      response: completion.text,
      finishReason: completion.finishReason,
      repairRound: repairsId === null ? 0 : 1,
      repairsId,
      latencyMs: completion.latencyMs,
      firstTokenMs: completion.firstTokenMs,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
    });
    return { generation, verdict: judge(completion, constraints, config.queue.maxTokens) };
  }

  /** @type {Candidate[]} */
  const candidates = [];
  for (const { sampling, candidateSeed } of draws) {
    let { generation, verdict } = await ask(messages, sampling, null);
    if (verdict.answer !== null) {
      const repair = buildRepairPrompt({ messages, answer: verdict.answer }, verdict.lint.findings);
      const tokens = estimateTokens(promptText(repair));
      if (tokens > budgetTokens) {
        const message = `the repair prompt is about ${tokens} tokens, over the ${budgetTokens}-token budget; no repair was sent`;
        const findings = [
          ...verdict.lint.findings,
          { path: "$", rule: REPAIR_OVER_BUDGET_RULE, message },
        ];
        verdict = { ...verdict, lint: lintResult(findings) };
      } else {
        ({ generation, verdict } = await ask(repair, sampling, generation.id));
      }
    }
    const genomeId = verdict.genome === null ? null : putGenome(store, vibeId, verdict.genome).id;
    candidates.push(
      addCandidate(store, {
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
      }),
    );
  }
  return { requestGroup, candidates };
}

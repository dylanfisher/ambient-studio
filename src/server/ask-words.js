// The words operator's request (decision 0084): one model request through the queue for the
// owner's words, its answer checked against the fields asked about, and one repair round for an
// answer that parsed. Each request is stored as a generation of the brief's current revision, in
// a request group naming the operator. Nothing else is written: the caller fills the page with
// the changes, unsaved. The words job runs it when the owner's route adds it; a search by ear's
// shift runs it from its own route, since the search holds the job runner (0075).
/** @import { WordsVerdict } from "../domain/check-words.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { WordsField } from "../domain/words-prompt.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { quotedErrors } from "../domain/build-repair-prompt.js";
import { judgeWords } from "../domain/check-words.js";
import { invalidAfter } from "../domain/judge-answer.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { buildWordsRepair, WORDS_RESPONSE_FORMAT } from "../domain/words-prompt.js";
import { STREAM_SEEDS } from "./candidate-job.js";
import {
  currentRevision,
  firstSampling,
  GENERATION_STEP,
  requestGroupName,
  sendRequest,
} from "./generate-candidates.js";
import { listRequestGroup } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { RETRIEVAL_METHOD } from "./retrieve-examples.js";

/** Each step of a request as the job tells the owner. */
const STEP = Object.freeze({
  [GENERATION_STEP.asking]: JOB_STEP.readingWords,
  [GENERATION_STEP.repairing]: JOB_STEP.repairingWords,
  [GENERATION_STEP.busy]: JOB_STEP.busy,
});

/**
 * @typedef {object} WordsRequest
 * @property {number} vibeId the brief the request is stored under
 * @property {number | null} sessionId the session it was asked from, if any
 * @property {string} operator named in the request group
 * @property {ChatMessage[]} messages the first prompt, built by the route
 * @property {readonly WordsField[]} fields the fields the answer is checked against
 */

/**
 * The checked answer, or why there is none, as a sentence for the owner.
 * @typedef {{ ok: true, changes: Record<string, unknown>, said: string, repaired: boolean,
 *   generationId: number } | { ok: false, error: string }} WordsAnswer
 */

/**
 * @param {App} app
 * @param {WordsRequest} request
 * @param {{ signal?: AbortSignal, onStep?: (step: string) => void }} [hooks] `signal` stops
 *   before the repair once aborted; `onStep` hears each step as a sentence
 * @returns {Promise<WordsAnswer>}
 */
export async function askWords(app, { vibeId, sessionId, operator, messages, fields }, hooks = {}) {
  const { store, config, queue } = app;
  const { signal, onStep } = hooks;
  const seed = Math.floor(app.random() * STREAM_SEEDS);
  const requestGroup = requestGroupName(vibeId, seed, operator);
  if (listRequestGroup(store, requestGroup).length > 0) {
    throw new Error(`request group ${requestGroup} already exists; ask again`);
  }
  const batch = {
    store,
    queue,
    config,
    vibeRevisionId: currentRevision(store, vibeId).revision.id,
    sessionId,
    requestGroup,
    exampleIds: [],
    attachmentIds: [],
    retrievalMethod: RETRIEVAL_METHOD.none,
    /** @param {{ kind: string }} step */
    onStep: ({ kind }) => onStep?.(STEP[/** @type {keyof typeof STEP} */ (kind)]),
  };
  const sampling = firstSampling(seed);
  /**
   * @param {ChatMessage[]} prompt
   * @param {number | null} repairsId
   * @returns {Promise<{ ok: true, verdict: WordsVerdict, generationId: number }
   *   | { ok: false, error: string }>}
   */
  const send = async (prompt, repairsId) => {
    const sent = await sendRequest(batch, 0, prompt, sampling, repairsId, WORDS_RESPONSE_FORMAT);
    if (sent.failure !== null) {
      return { ok: false, error: `The model couldn't be asked: ${sent.failure.message}` };
    }
    const verdict = judgeWords(sent.completion, config.queue.maxTokens, fields);
    return { ok: true, verdict, generationId: sent.generation.id };
  };
  const first = await send(messages, null);
  if (!first.ok) return first;
  let { verdict, generationId } = first;
  let repaired = false;
  if (!verdict.ok && verdict.answer !== null) {
    const repair = buildWordsRepair({ messages, answer: verdict.answer }, verdict.errors);
    const tokens = estimateTokens(promptText(repair));
    if (tokens > config.queue.contextBudgetTokens) {
      const findings = quotedErrors(verdict.errors).join("\n");
      return {
        ok: false,
        error: `The model's reading of your words was invalid, and its repair prompt is about ${tokens} tokens, over the ${config.queue.contextBudgetTokens}-token budget, so no repair was sent:\n${findings}`,
      };
    }
    signal?.throwIfAborted();
    const second = await send(repair, generationId);
    if (!second.ok) return second;
    ({ verdict, generationId } = second);
    repaired = true;
  }
  if (!verdict.ok) {
    return {
      ok: false,
      error: `The model's reading of your words was ${invalidAfter(repaired)}, so nothing was changed:\n${quotedErrors(verdict.errors).join("\n")}`,
    };
  }
  return { ok: true, changes: verdict.changes, said: verdict.said, repaired, generationId };
}

/**
 * The words job: `askWords` with the job's progress and cancel. A cancel cancels the omlx
 * queue, as a drafted brief's does: the runner runs one job at a time, so the queue holds only
 * this job's requests.
 * @param {App} app
 * @param {WordsRequest} request
 * @returns {(job: JobContext) => Promise<{ changes: Record<string, unknown>, said: string,
 *   repaired: boolean, generationId: number }>}
 */
export function wordsJob(app, request) {
  return async (job) => {
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      const answer = await askWords(app, request, {
        signal: job.signal,
        onStep: (step) => job.progress(0, 1, step),
      });
      if (!answer.ok) throw new Error(answer.error);
      job.progress(1, 1, null);
      const { changes, said, repaired, generationId } = answer;
      return { changes, said, repaired, generationId };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

// The words operator's request (decision 0084): one model request through the queue for the
// owner's words, its answer checked against the fields asked about and, when the request has a
// check of its own, by that (a track's arrangement validator, 0087), and one repair round for an
// answer that parsed. Each request is stored as a generation of the brief's current revision, in
// a request group naming the operator. Nothing else is written: the caller fills the page with
// the changes, unsaved. It runs as a words job, which the job runner runs in its words lane,
// beside whatever the main lane runs (0092): the words route's, and a search by ear's shift.
/** @import { QuotedError } from "../domain/build-repair-prompt.js" */
/** @import { WordsVerdict } from "../domain/check-words.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { WordsField } from "../domain/words-prompt.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { OmlxQueue } from "./omlx-queue.js" */
/** @import { App } from "./routing.js" */
import { quotedErrors } from "../domain/build-repair-prompt.js";
import { judgeWords } from "../domain/check-words.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { invalidAfter } from "../domain/judge-answer.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { REJECT_REASON } from "../domain/reject-reason.js";
import { buildWordsRepair, WORDS_KEY, WORDS_RESPONSE_FORMAT } from "../domain/words-prompt.js";
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
import { ownedBy } from "./omlx-queue.js";
import { RETRIEVAL_METHOD } from "./retrieve-examples.js";
import { refuseUnfinished } from "./routing.js";

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
 * @property {(changes: Record<string, unknown>) => QuotedError[]} [check] findings on changes
 *   the fields allow, quoted in the repair as the fields' are
 */

/**
 * The checked answer, or why there is none, as a sentence for the owner.
 * @typedef {{ ok: true, changes: Record<string, unknown>, said: string, repaired: boolean,
 *   generationId: number } | { ok: false, error: string }} WordsAnswer
 */

/**
 * @param {App} app
 * @param {WordsRequest} request
 * @param {{ queue: OmlxQueue, signal: AbortSignal, onStep: (step: string) => void }} hooks
 *   `queue` is the job's own; `signal` stops before the repair once aborted; `onStep` hears each
 *   step as a sentence
 * @returns {Promise<WordsAnswer>}
 */
async function askWords(app, { vibeId, sessionId, operator, messages, fields, check }, hooks) {
  const { store, config } = app;
  const { queue, signal, onStep } = hooks;
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
    onStep: ({ kind }) => onStep(STEP[/** @type {keyof typeof STEP} */ (kind)]),
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
    const judged = judgeWords(sent.completion, config.queue.maxTokens, fields);
    const errors = judged.ok && check ? check(judged.changes) : [];
    /** @type {WordsVerdict} */
    const verdict =
      judged.ok && errors.length > 0
        ? {
            ok: false,
            reason: REJECT_REASON.schemaErrors,
            errors,
            answer: { [WORDS_KEY.changes]: judged.changes, [WORDS_KEY.said]: judged.said },
          }
        : judged;
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
    signal.throwIfAborted();
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
 * Refuses a second words job while one is unfinished, from either route that adds one: the
 * words lane runs one at a time, and the owner waits on the one already asked (0084, 0092).
 * @param {App} app
 */
export function refuseSecondWords(app) {
  refuseUnfinished(
    app,
    JOB_KIND.words,
    (id) =>
      `The model is already reading your words (job ${id}). Wait for it to finish, or cancel it.`,
  );
}

/**
 * What a words job returns before its caller shapes it.
 * @typedef {{ changes: Record<string, unknown>, said: string, repaired: boolean,
 *   generationId: number }} WordsResult
 */

/**
 * The words job: `askWords` with the job's progress and cancel. A cancel cancels only this
 * job's omlx requests (decision 0092), since a main-lane job may have its own in the queue.
 * @template [T=WordsResult]
 * @param {App} app
 * @param {WordsRequest} request
 * @param {(answer: WordsResult) => T} [shape] turns the checked answer into the job's result;
 *   the answer as it is when omitted
 * @returns {(job: JobContext) => Promise<T>}
 */
export function wordsJob(
  app,
  request,
  shape = (answer) => /** @type {T} */ (/** @type {unknown} */ (answer)),
) {
  return async (job) => {
    const queue = ownedBy(app.queue, job.signal);
    const cancelRequests = () => queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      const answer = await askWords(app, request, {
        queue,
        signal: job.signal,
        onStep: (step) => job.progress(0, 1, step),
      });
      if (!answer.ok) throw new Error(answer.error);
      const { changes, said, repaired, generationId } = answer;
      const result = shape({ changes, said, repaired, generationId });
      job.progress(1, 1, null);
      return result;
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

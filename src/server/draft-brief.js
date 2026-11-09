// Drafts a brief from the owner's words (decision 0074): one model request through the queue,
// the answer checked with the validators Save uses, and one repair round for one that parsed.
// The job returns the draft for the brief page to fill its form with; nothing is saved as a
// revision. Reworking a saved brief stores each request as a generation of its current
// revision, operator `draft`; a new brief has no revision, so its requests aren't stored. It
// runs only when the owner's route adds it.
/** @import { DraftVerdict } from "../domain/check-draft-brief.js" */
/** @import { BriefDraft, DraftLimits } from "../domain/draft-brief-prompt.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { quotedErrors } from "../domain/build-repair-prompt.js";
import { judgeDraftBrief } from "../domain/check-draft-brief.js";
import { buildDraftBriefRepair } from "../domain/draft-brief-prompt.js";
import { invalidAfter } from "../domain/judge-answer.js";
import { OPERATOR } from "../domain/operator.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { VIBE_DRAFT_FIELD } from "../domain/vibe-draft.js";
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
import { MAX_CHARS } from "./request-fields.js";
import { RETRIEVAL_METHOD } from "./retrieve-examples.js";

/** The answer's JSON schema, sent as `response_format` when the config asks for it (0022). */
const DRAFT_RESPONSE_FORMAT = Object.freeze({
  name: "brief_answer",
  schema: {
    type: "object",
    properties: {
      [VIBE_DRAFT_FIELD.name]: { type: "string" },
      [VIBE_DRAFT_FIELD.brief]: { type: "string" },
      [VIBE_DRAFT_FIELD.constraints]: { type: "object" },
      [VIBE_DRAFT_FIELD.softTargets]: { type: "object" },
    },
    required: Object.values(VIBE_DRAFT_FIELD),
    additionalProperties: false,
  },
});

/**
 * The limits a draft's name and description are held to: the save route's.
 * @type {DraftLimits}
 */
export const DRAFT_LIMITS = Object.freeze({ name: MAX_CHARS.name, brief: MAX_CHARS.brief });

/**
 * @param {App} app
 * @param {{ vibeId: number | null, messages: ChatMessage[] }} request the saved brief being
 *   reworked, null for a new one, and the first prompt, built by the route
 * @returns {(job: JobContext) => Promise<{ draft: BriefDraft, repaired: boolean,
 *   generationId: number | null }>} `generationId` is the last request's, null when none was
 *   stored
 */
export function draftBriefJob(app, { vibeId, messages }) {
  return async (job) => {
    const { store, config } = app;
    const queue = ownedBy(app.queue, job.signal);
    const cancelRequests = () => queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      const seed = Math.floor(app.random() * STREAM_SEEDS);
      const sampling = firstSampling(seed);
      /** @param {boolean} repair */
      const step = (repair) =>
        job.progress(0, 1, repair ? JOB_STEP.repairingBrief : JOB_STEP.draftingBrief);
      const onRetry = () => job.progress(0, 1, JOB_STEP.busy);
      /** @type {import("./generate-candidates.js").RequestBatch | null} */
      let batch = null;
      if (vibeId !== null) {
        const requestGroup = requestGroupName(vibeId, seed, OPERATOR.draft);
        if (listRequestGroup(store, requestGroup).length > 0) {
          throw new Error(`request group ${requestGroup} already exists; ask again`);
        }
        batch = {
          store,
          queue,
          config,
          vibeRevisionId: currentRevision(store, vibeId).revision.id,
          sessionId: null,
          requestGroup,
          exampleIds: [],
          attachmentIds: [],
          retrievalMethod: RETRIEVAL_METHOD.none,
          onStep: ({ kind }) =>
            kind === GENERATION_STEP.busy ? onRetry() : step(kind === GENERATION_STEP.repairing),
        };
      }
      /**
       * @param {ChatMessage[]} prompt
       * @param {number | null} repairsId the stored first try a repair names; null for a first
       *   try, and for a repair when nothing is stored
       * @param {boolean} repair
       * @returns {Promise<{ verdict: DraftVerdict, generationId: number | null }>}
       */
      const send = async (prompt, repairsId, repair) => {
        const judge = (/** @type {{ text: string, finishReason: string }} */ completion) =>
          judgeDraftBrief(completion, config.queue.maxTokens, DRAFT_LIMITS);
        if (batch === null) {
          step(repair);
          const completion = await queue.request({
            messages: prompt,
            sampling,
            responseFormat: DRAFT_RESPONSE_FORMAT,
            onRetry,
          });
          return { verdict: judge(completion), generationId: null };
        }
        const sent = await sendRequest(
          batch,
          0,
          prompt,
          sampling,
          repairsId,
          DRAFT_RESPONSE_FORMAT,
        );
        if (sent.failure !== null) throw sent.failure;
        return { verdict: judge(sent.completion), generationId: sent.generation.id };
      };
      let { verdict, generationId } = await send(messages, null, false);
      let repaired = false;
      if (!verdict.ok && verdict.answer !== null) {
        const repair = buildDraftBriefRepair({ messages, answer: verdict.answer }, verdict.errors);
        const tokens = estimateTokens(promptText(repair));
        if (tokens > config.queue.contextBudgetTokens) {
          throw new Error(
            `The model's brief was invalid, and its repair prompt is about ${tokens} tokens, over the ${config.queue.contextBudgetTokens}-token budget, so no repair was sent:\n${quotedErrors(verdict.errors).join("\n")}`,
          );
        }
        job.signal.throwIfAborted();
        ({ verdict, generationId } = await send(repair, generationId, true));
        repaired = true;
      }
      if (!verdict.ok) {
        throw new Error(
          `The model's brief was ${invalidAfter(repaired)}, so the form is left as it was:\n${quotedErrors(verdict.errors).join("\n")}`,
        );
      }
      job.progress(1, 1, null);
      return { draft: verdict.draft, repaired, generationId };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

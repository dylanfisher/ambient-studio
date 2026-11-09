// Develops one section of a track (decision 0079): one model request through the queue,
// operator `develop`, reading the stored rows `buildDevelopPrompt` is written from, the
// neighbors' genomes where they meet the section among them; the answer checked as a genome of
// the section's length, with one repair round for one that parsed. A valid one is
// stored as the track's development, with the sketch's seed; the sketch's own rows are never
// written. Nothing is rendered, and the timeline puts the development in its section. It runs
// only when the owner's route adds it.
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { DevelopmentAsk } from "../domain/check-development.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { judgeDevelopment } from "../domain/check-development.js";
import { buildDevelopPrompt, buildDevelopRepair } from "../domain/develop-prompt.js";
import { MEETING_EDGE, meetingState } from "../domain/meeting-state.js";
import { OPERATOR } from "../domain/operator.js";
import { fittedGenome } from "../domain/section-genome.js";
import { recordingRefs } from "../engine/recording-refs.js";
import { requireGenome } from "../engine/validate-genome.js";
import { STREAM_SEEDS } from "./candidate-job.js";
import { addDevelopment, getDevelopment } from "./development-store.js";
import {
  answerWithRepair,
  currentRevision,
  firstSampling,
  GENERATION_STEP,
  requestGroupName,
} from "./generate-candidates.js";
import { listRequestGroup, putGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { sketchReadings } from "./rating-routes.js";
import { getSketch } from "./rating-store.js";
import { RETRIEVAL_METHOD } from "./retrieve-examples.js";
import { transaction } from "./store.js";
import { sectionSources, sketchParts } from "./track-manifest.js";

/** The answer's JSON schema, sent as `response_format` when the config asks for it (0022). */
const DEVELOP_RESPONSE_FORMAT = Object.freeze({
  name: "development_answer",
  schema: { type: "object" },
});

/** The share of the context budget the first prompt may take; the rest is the repair's (0024). */
export const FIRST_PROMPT_SHARE = 0.5;

/**
 * What the owner asked for: one section of one saved revision, checked by the route.
 * @typedef {object} DevelopRequest
 * @property {{ id: number, vibeId: number }} track
 * @property {number} revisionId
 * @property {Arrangement} arrangement the revision's, valid
 * @property {number} index the section's, from 0
 */

/**
 * Where the section starts on its sketch's timeline: its offset, or, when it plays a development
 * already, the offset that development was written from. Developing again starts from the sketch.
 * @param {App} app
 * @param {{ offset: number, developmentId: number | null }} section
 */
function sketchOffset({ store }, { offset, developmentId }) {
  if (developmentId === null) return offset;
  const development = getDevelopment(store, developmentId);
  if (!development) throw new Error(`there is no development ${developmentId}`);
  return development.offset;
}

/**
 * The job that develops a section and stores the development. When the answer is still invalid
 * after its one repair, or can't be repaired, the job fails listing every finding and stores no
 * development; every request stays stored as a generation. Cancelling the job cancels the omlx
 * queue: the runner runs one job at a time, so while this one runs the queue holds only its
 * requests.
 * @param {App} app
 * @param {DevelopRequest} request
 * @returns {(job: JobContext) => Promise<{ developmentId: number, trackId: number,
 *   revisionId: number, index: number, generationId: number, repaired: boolean,
 *   left: string[] }>}
 */
export function developJob(app, { track, revisionId, arrangement, index }) {
  return async (job) => {
    const { store, config } = app;
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      job.progress(0, 1, JOB_STEP.readingSection);
      const section = arrangement.sections[index];
      if (!section) throw new Error(`there is no section ${index + 1}`);
      const sketch = getSketch(store, section.sketchId);
      if (!sketch) throw new Error(`there is no sketch ${section.sketchId}`);
      const { candidate, genome: stored } = sketchParts(store, sketch);
      const genome = requireGenome(stored, `sketch ${sketch.id}'s genome`);
      const readings = sketchReadings(app, candidate, stored);
      const { genomes } = sectionSources(store, arrangement);
      const previous = arrangement.sections[index - 1];
      const next = arrangement.sections[index + 1];
      const { revision, constraints, ranges } = currentRevision(store, track.vibeId);
      const offset = sketchOffset(app, section);
      const built = buildDevelopPrompt({
        revision: { name: revision.name, brief: revision.brief, constraints, ranges },
        arc: arrangement.arc,
        index,
        count: arrangement.sections.length,
        section: { offset, seconds: section.seconds, text: section.text },
        sketch: { id: sketch.id, genome, reading: readings.sketch, lineage: readings.lineage },
        before:
          previous === undefined
            ? null
            : meetingState(
                fittedGenome(arrangement, index - 1, genomes),
                previous.offset + previous.seconds,
                MEETING_EDGE.end,
              ),
        after:
          next === undefined
            ? null
            : meetingState(
                fittedGenome(arrangement, index + 1, genomes),
                next.offset,
                MEETING_EDGE.start,
              ),
        budgetTokens: Math.floor(config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
      });
      job.signal.throwIfAborted();
      /** @type {DevelopmentAsk} */
      const ask = {
        seconds: section.seconds,
        constraints,
        recordings: new Set(recordingRefs(genome).map(({ hash }) => hash)),
      };
      const { generation, developed, repaired } = await askDevelopment(app, job, {
        vibeId: track.vibeId,
        vibeRevisionId: revision.id,
        messages: built.messages,
        ask,
        progress: { done: 0, of: 1 },
      });
      const development = transaction(store, () =>
        addDevelopment(store, {
          trackId: track.id,
          sketchId: sketch.id,
          text: section.text,
          offset,
          seconds: section.seconds,
          genomeId: putGenome(store, track.vibeId, developed).id,
          seed: candidate.seed,
          generationId: generation.id,
          bridge: false,
        }),
      );
      job.progress(1, 1, null);
      return {
        developmentId: development.id,
        trackId: track.id,
        revisionId,
        index,
        generationId: generation.id,
        repaired,
        left: built.left,
      };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

/**
 * Sends one development's prompt through the queue in a new request group of operator
 * `develop`, with one repair for an answer that parsed, and returns the checked genome. Throws
 * when the answer is still invalid, or when the job was cancelled. A bridge (0081) sends one per
 * part.
 * @param {App} app
 * @param {JobContext} job
 * @param {object} request
 * @param {number} request.vibeId
 * @param {number} request.vibeRevisionId the brief's revision the prompt was written from
 * @param {ChatMessage[]} request.messages
 * @param {DevelopmentAsk} request.ask
 * @param {{ done: number, of: number }} request.progress the job's progress while it asks
 */
export async function askDevelopment(
  app,
  job,
  { vibeId, vibeRevisionId, messages, ask, progress },
) {
  const { store, config } = app;
  const seed = Math.floor(app.random() * STREAM_SEEDS);
  const requestGroup = requestGroupName(vibeId, seed, OPERATOR.develop);
  if (listRequestGroup(store, requestGroup).length > 0) {
    throw new Error(`request group ${requestGroup} already exists; develop again`);
  }
  const sampling = firstSampling(seed);
  const batch = {
    store,
    queue: app.queue,
    config,
    vibeRevisionId,
    sessionId: null,
    requestGroup,
    exampleIds: [],
    attachmentIds: [],
    retrievalMethod: RETRIEVAL_METHOD.none,
    /** @param {{ kind: string }} step */
    onStep: ({ kind }) =>
      job.progress(
        progress.done,
        progress.of,
        kind === GENERATION_STEP.asking
          ? JOB_STEP.developing
          : kind === GENERATION_STEP.repairing
            ? JOB_STEP.repairingDevelopment
            : JOB_STEP.busy,
      ),
  };
  const { generation, verdict, repaired } = await answerWithRepair({
    batch,
    messages,
    sampling,
    responseFormat: DEVELOP_RESPONSE_FORMAT,
    judge: (completion) => judgeDevelopment(completion, config.queue.maxTokens, ask),
    buildRepair: buildDevelopRepair,
    signal: job.signal,
    what: "development",
  });
  job.signal.throwIfAborted();
  return { generation, developed: verdict.genome, repaired };
}

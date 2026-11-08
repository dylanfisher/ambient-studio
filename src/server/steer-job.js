// The steer job (decision 0056): 5e's search job from a base candidate, at a small budget,
// scoring each point by how near its position on each chosen direction sits to that slider's
// setting and how near its sound sits to each chosen region, plus the brief's taste model score
// at a small weight when a current model exists. A brief with no model steers by the terms
// alone. Every point is a session candidate with operator `steer`, and records the directions
// and regions it read. It runs only when the owner's request adds it to the job runner.
/** @import { Steering } from "../domain/steer-terms.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Embedder } from "./embed-audio.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { App } from "./routing.js" */
/** @import { EmbeddedExcerpt, ScorerFactory } from "./search-job.js" */
/** @import { SteerChoices } from "./vibe-steering.js" */
import { OPERATOR } from "../domain/operator.js";
import { PREFERENCE_STATE } from "../domain/preference-text.js";
import { termsScore } from "../domain/search-score.js";
import { steerTerms } from "../domain/steer-terms.js";
import { embedText, readEmbedder } from "./embed-audio.js";
import { JOB_STEP } from "./job-steps.js";
import { currentModel } from "./preference-summary.js";
import { modelScores, renderAndEmbed, searchJob } from "./search-job.js";
import { chosenSteering, readSteering } from "./vibe-steering.js";

/**
 * Renders and embeds a batch of points; tests script one.
 * @typedef {(app: App, embedder: Embedder, recordings: readonly RecordingEntry[]) =>
 *   (candidates: Candidate[], signal: AbortSignal) => Promise<EmbeddedExcerpt[]>} EmbedExcerpts
 */

/**
 * @typedef {object} SteerRequest
 * @property {number} vibeId
 * @property {number} sessionId
 * @property {Candidate} base
 * @property {Genome} genome the base's
 * @property {number} budget points the steer asks for, rejected ones included
 * @property {SteerChoices} choices
 */

/**
 * The vibe's steering under the sidecar's embedder, and the choices' part of it, or why they
 * can't be steered by: no checkpoint, or a direction or region with no vector or scale yet. The
 * route refuses with the reason, and the job fails with it when it changed between the two.
 * @param {App} app
 * @param {number} vibeId
 * @param {SteerChoices} choices
 * @param {AbortSignal} signal
 * @returns {Promise<{ embedder: Embedder, steering: Steering } | string>}
 */
export async function readChosenSteering(app, vibeId, choices, signal) {
  const embedder = await readEmbedder(app, { fetch: false, signal });
  if (typeof embedder === "string") {
    return `A steer places each point by its sound analysis, which is off: ${embedder}.`;
  }
  const read = await readSteering(app.store, vibeId, {
    producer: embedder.producer,
    embedText: (text, what) => embedText(app, embedder, text, what, signal),
  });
  const steering = chosenSteering(read, choices);
  return typeof steering === "string" ? steering : { embedder, steering };
}

/**
 * The steer's scorer: each point's terms, and with a current taste model, its search score.
 * @param {SteerChoices} choices
 * @param {EmbedExcerpts} embedExcerpts
 * @param {(usedModel: boolean) => void} onModel told once whether the model's score is used
 * @returns {ScorerFactory}
 */
const steerScorer = (choices, embedExcerpts, onModel) => async (app, context) => {
  const { vibeId, recordings, signal } = context;
  const read = await readChosenSteering(app, vibeId, choices, signal);
  if (typeof read === "string") throw new Error(read);
  const { embedder, steering } = read;
  const found = await currentModel(app, vibeId, signal);
  const model = found.state === PREFERENCE_STATE.fitted ? found : null;
  onModel(model !== null);
  const embed = embedExcerpts(app, embedder, recordings);
  return async (candidates, signal) => {
    const made = await embed(candidates, signal);
    const terms = made.map(({ embedding }) => steerTerms(embedding, steering));
    const scores =
      model === null ? terms.map(termsScore) : await modelScores(app, model, made, terms, signal);
    return made.map(({ embedding, seconds }, i) => ({
      embedding,
      seconds,
      score: /** @type {number} */ (scores[i]),
    }));
  };
};

/**
 * The job that steers from `base`: a search with the steer's scorer and operator, and no
 * control arm. Its result adds whether the taste model's score was used.
 * @param {App} app
 * @param {SteerRequest} request
 * @param {{ embedExcerpts?: EmbedExcerpts }} [options] renders and embeds when omitted
 * @returns {(job: import("./job-runner.js").JobContext) => Promise<unknown>}
 */
export function steerJob(app, request, { embedExcerpts = renderAndEmbed } = {}) {
  const { choices, ...search } = request;
  let usedModel = false;
  const run = searchJob(
    app,
    { ...search, raw: [], control: false },
    {
      makeScorer: steerScorer(choices, embedExcerpts, (used) => (usedModel = used)),
      operator: OPERATOR.steer,
      params: { steer: choices },
      step: JOB_STEP.steering,
    },
  );
  return async (job) => {
    const result = /** @type {Record<string, unknown>} */ (await run(job));
    return { ...result, model: usedModel };
  };
}

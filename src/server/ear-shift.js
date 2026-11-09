// Reads the owner's words for a shift as a search by ear's sliders (decision 0075): one model
// request through the queue, stored as a generation in a request group of its own, its answer
// checked as the steering route checks the page's. The search isn't told: the page sets its
// sliders from the answer, and the owner sends them.
/** @import { EarChannel } from "./ear-search-job.js" */
/** @import { App } from "./routing.js" */
import { OPERATOR } from "../domain/operator.js";
import { buildShiftPrompt, readShift, SHIFT_RESPONSE_FORMAT } from "../domain/shift-prompt.js";
import { toVector } from "../engine/vector-view.js";
import { STREAM_SEEDS } from "./candidate-job.js";
import {
  currentRevision,
  requestGroupName,
  samplingStream,
  sendRequest,
} from "./generate-candidates.js";
import { getGenome, listRequestGroup } from "./generation-store.js";
import { RETRIEVAL_METHOD } from "./retrieve-examples.js";
import { HttpError } from "./routing.js";

/**
 * @param {App} app
 * @param {{ id: number, vibeId: number }} session open
 * @param {EarChannel} channel the session's search by ear, still running
 * @param {string} words the owner's, one line
 * @returns {Promise<{ shift: Record<string, number>, generationId: number }>}
 */
export async function readShiftWords(app, session, channel, words) {
  const { paths, best } = channel.view();
  if (paths.length === 0 || best === null) {
    throw new HttpError(
      409,
      "The search by ear is still starting; describe a shift once its first pair shows.",
    );
  }
  const row = getGenome(app.store, best.genomeId);
  if (!row) throw new Error(`the search's best names genome ${best.genomeId}, which has no row`);
  const { revision } = currentRevision(app.store, session.vibeId);
  const prompt = buildShiftPrompt({
    brief: revision.brief,
    paths,
    positions: toVector(row.genome, paths),
    words,
  });
  const seed = Math.floor(app.random() * STREAM_SEEDS);
  const requestGroup = requestGroupName(session.vibeId, seed, OPERATOR.shift);
  if (listRequestGroup(app.store, requestGroup).length > 0) {
    throw new Error(`request group ${requestGroup} already exists; describe the shift again`);
  }
  // One draw asked for is one given.
  const { sampling } = /** @type {ReturnType<typeof samplingStream>[number]} */ (
    samplingStream(seed, 1)[0]
  );
  const batch = {
    store: app.store,
    queue: app.queue,
    config: app.config,
    vibeRevisionId: revision.id,
    sessionId: session.id,
    requestGroup,
    exampleIds: [],
    attachmentIds: [],
    retrievalMethod: RETRIEVAL_METHOD.none,
  };
  const sent = await sendRequest(batch, 0, prompt, sampling, null, SHIFT_RESPONSE_FORMAT);
  if (sent.failure !== null) {
    throw new HttpError(502, `The model couldn't be asked: ${sent.failure.message}`);
  }
  const read = readShift(sent.completion, paths);
  if (!read.ok) {
    throw new HttpError(
      502,
      `The model's answer couldn't be read as a shift: ${read.error}. Describe it again, or set the sliders by hand.`,
    );
  }
  return { shift: read.shift, generationId: sent.generation.id };
}

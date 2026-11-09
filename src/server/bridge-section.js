// Writes a bridge for one join of a track (decision 0081): the develop operator (0079) once,
// or once per half when the two sections differ in a join global, each request read from the
// two sections' stored rows with both neighbors as fixed ends, its answer held to the bridge's
// end rules with one repair round. The second half is written from the first one's answer. Every
// part is stored as the track's development, marked a bridge, in one transaction once all are
// written, so a cancel or a failure stores none. Nothing is rendered, and the timeline puts the
// bridge between the two sections. It runs only when the owner's route adds it, which first
// builds every part's prompt and refuses one that can't fit (0082).
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { BridgePart, BridgePlan } from "../domain/bridge-plan.js" */
/** @import { BridgeEdge, BridgeEnds } from "../domain/check-bridge.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { MORPH_CURVE } from "../domain/arrangement-schema.js";
import { BRIDGE_PART } from "../domain/bridge-plan.js";
import { sharedGlobals } from "../domain/check-bridge.js";
import { buildDevelopPrompt, DevelopPromptTooLong } from "../domain/develop-prompt.js";
import { BRIDGE_STATE_TOKENS, MEETING_EDGE, meetingState } from "../domain/meeting-state.js";
import { estimateTokens } from "../domain/prompt-tokens.js";
import { fittedGenome } from "../domain/section-genome.js";
import { recordingRefs } from "../engine/recording-refs.js";
import { requireGenome } from "../engine/validate-genome.js";
import { askDevelopment, FIRST_PROMPT_SHARE } from "./develop-section.js";
import { addDevelopment, getDevelopment } from "./development-store.js";
import { currentRevision } from "./generate-candidates.js";
import { putGenome } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { ownedBy } from "./omlx-queue.js";
import { sketchReadings } from "./rating-routes.js";
import { getSketch } from "./rating-store.js";
import { transaction } from "./store.js";
import { sectionSources, sketchParts } from "./track-manifest.js";

/**
 * What the owner asked for: a bridge of one join of one saved revision, checked by the route.
 * @typedef {object} BridgeRequest
 * @property {{ id: number, vibeId: number }} track
 * @property {number} revisionId
 * @property {Arrangement} arrangement the revision's, valid
 * @property {number} index the transition's, from 0
 * @property {BridgePlan} plan `bridgePlan` of the transition and the owner's seconds
 */

/**
 * The section's seconds on its sketch's timeline: on a developed section, its offset is on the
 * development's timeline, which starts where the development was written from on the sketch.
 * @param {App} app
 * @param {Section} section
 * @param {number} at seconds on the section's own genome's timeline
 */
function onSketch({ store }, { developmentId }, at) {
  if (developmentId === null) return at;
  const development = getDevelopment(store, developmentId);
  if (!development) throw new Error(`there is no development ${developmentId}`);
  return development.offset + at;
}

/**
 * A section's sketch as a bridge's prompt reads it, with the rows its development names.
 * @param {App} app
 * @param {number} sketchId
 */
function readSketch(app, sketchId) {
  const sketch = getSketch(app.store, sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId}`);
  const { candidate, genome: stored } = sketchParts(app.store, sketch);
  const genome = requireGenome(stored, `sketch ${sketch.id}'s genome`);
  const readings = sketchReadings(app, candidate, stored);
  return { id: sketch.id, seed: candidate.seed, genome, readings };
}

/**
 * Everything a bridge's prompts are read from, read once from the stored rows.
 * @param {App} app
 * @param {BridgeRequest} request
 */
function bridgeSetup(app, { track, arrangement, index, plan }) {
  const of = plan.parts.length;
  const out = /** @type {Section} */ (arrangement.sections[index]);
  const into = /** @type {Section} */ (arrangement.sections[index + 1]);
  const text = /** @type {{ text: string }} */ (arrangement.transitions[index]).text;
  const { genomes } = sectionSources(app.store, arrangement);
  const outgoing = fittedGenome(arrangement, index, genomes);
  const incoming = fittedGenome(arrangement, index + 1, genomes);
  const sketches = [readSketch(app, out.sketchId), readSketch(app, into.sketchId)];
  const recordings = new Set(
    sketches.flatMap(({ genome }) => recordingRefs(genome).map(({ hash }) => hash)),
  );
  const held = sharedGlobals(outgoing, incoming);
  const { revision, constraints, ranges } = currentRevision(app.store, track.vibeId);
  // Sections are numbered as they will stand with the bridge in place.
  const from = index + 1;
  const to = index + of + 2;
  /** @type {BridgeEdge} */
  const start = {
    genome: outgoing,
    at: out.offset + out.seconds,
    name: `section ${from}`,
    globals: true,
    through: plan.into,
    weave: { seconds: plan.into, curve: MORPH_CURVE },
  };
  /** @type {BridgeEdge} */
  const end = {
    genome: incoming,
    at: into.offset,
    name: `section ${to}`,
    globals: true,
    through: plan.out,
    weave: { seconds: plan.out, curve: MORPH_CURVE },
  };
  return {
    of,
    out,
    into,
    text,
    sketches,
    recordings,
    held,
    revision,
    constraints,
    ranges,
    from,
    to,
    start,
    end,
  };
}

/** @typedef {ReturnType<typeof bridgeSetup>} BridgeSetup */

/**
 * Part `i`'s ends and first prompt. Throws `DevelopPromptTooLong` naming the join when the
 * prompt can't fit with both readings left out, saying so when a state is over its cap because
 * the settings its check compares exactly are long (decision 0082).
 * @param {App} app
 * @param {BridgeRequest} request
 * @param {BridgeSetup} setup
 * @param {number} i
 * @param {{ genome: Genome, at: number } | null} previous where the first half ends, for the
 *   second half
 */
function bridgePart(app, { arrangement, index, plan }, setup, i, previous) {
  const { of, text, sketches, held, revision, constraints, ranges, from, to } = setup;
  const { seconds } = /** @type {{ seconds: number }} */ (plan.parts[i]);
  /** @type {BridgePart} */
  const part = of === 1 ? BRIDGE_PART.whole : i === 0 ? BRIDGE_PART.first : BRIDGE_PART.second;
  const second = part === BRIDGE_PART.second;
  const middle = /** @type {number} */ (plan.middle);
  /** @type {BridgeEnds} */
  const ends = {
    start: previous
      ? {
          genome: previous.genome,
          at: previous.at,
          name: `section ${from + 1}`,
          globals: false,
          through: middle,
          weave: null,
        }
      : setup.start,
    end: part === BRIDGE_PART.first ? null : setup.end,
    // Only two halves change key; the first's last seconds and the second's first cross.
    keyless: !plan.keyless
      ? null
      : second
        ? { from: 0, to: middle }
        : { from: seconds - middle, to: seconds },
    held,
  };
  const sketch = /** @type {(typeof sketches)[number]} */ (sketches[second ? 1 : 0]);
  const state = (/** @type {BridgeEdge | null} */ edge, /** @type {boolean} */ starts) =>
    edge === null
      ? null
      : meetingState(
          edge.genome,
          edge.at,
          starts ? MEETING_EDGE.end : MEETING_EDGE.start,
          BRIDGE_STATE_TOKENS,
          { fixed: true },
        );
  const before = state(ends.start, true);
  const after = state(ends.end, false);
  try {
    const built = buildDevelopPrompt({
      revision: { name: revision.name, brief: revision.brief, constraints, ranges },
      arc: arrangement.arc,
      index: index + 1 + i,
      count: arrangement.sections.length + of,
      section: { offset: 0, seconds, text },
      sketch: {
        id: sketch.id,
        genome: sketch.genome,
        reading: sketch.readings.sketch,
        lineage: sketch.readings.lineage,
      },
      before,
      after,
      bridge: {
        part,
        from,
        to,
        into: plan.into,
        out: plan.out,
        middle: plan.middle,
        differs: plan.differs,
        keyless: plan.keyless,
        held,
      },
      budgetTokens: Math.floor(app.config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
    });
    return { ends, built, seconds };
  } catch (error) {
    if (!(error instanceof DevelopPromptTooLong)) throw error;
    const long = [before, after].some(
      (lines) => lines !== null && estimateTokens(lines.join("\n")) > BRIDGE_STATE_TOKENS,
    );
    const why = long
      ? "the two sections' settings that can't move are too long to quote exactly in one request, and a bridge's check compares them at every digit"
      : "its prompt is too long for one request";
    throw new DevelopPromptTooLong(
      `Can't bridge the join between sections ${index + 1} and ${index + 2}: ${why} (${error.message})`,
      error.tokens,
      error.budgetTokens,
    );
  }
}

/**
 * Builds every part's first prompt before the job is added, so a bridge whose prompt can't fit
 * is refused before any request: throws `DevelopPromptTooLong` naming the join. The second
 * half starts where the first half ends, which isn't written yet, so the outgoing section's end
 * stands in for it: the first half starts holding exactly those voices.
 * @param {App} app
 * @param {BridgeRequest} request
 */
export function bridgeRoom(app, request) {
  const setup = bridgeSetup(app, request);
  for (const i of request.plan.parts.keys()) {
    bridgePart(
      app,
      request,
      setup,
      i,
      i === 0 ? null : { genome: setup.start.genome, at: setup.start.at },
    );
  }
}

/**
 * The job that writes a bridge and stores its parts.
 * @param {App} app
 * @param {BridgeRequest} request
 * @returns {(job: JobContext) => Promise<{ developmentIds: number[], trackId: number,
 *   revisionId: number, transition: number, plan: BridgePlan, generationIds: number[],
 *   repaired: boolean[] }>}
 */
export function bridgeJob(app, request) {
  const { track, revisionId, index, plan } = request;
  return async (job) => {
    const { store } = app;
    const queue = ownedBy(app.queue, job.signal);
    const cancelRequests = () => queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      const of = plan.parts.length;
      job.progress(0, of, JOB_STEP.readingBridge);
      const setup = bridgeSetup(app, request);
      const { out, into, text, sketches, recordings, revision, constraints } = setup;
      /** @type {{ genome: Genome, generationId: number, repaired: boolean }[]} */
      const written = [];
      for (const i of plan.parts.keys()) {
        const previous = written[i - 1];
        const { ends, built, seconds } = bridgePart(
          app,
          request,
          setup,
          i,
          previous ? { genome: previous.genome, at: previous.genome.duration } : null,
        );
        job.signal.throwIfAborted();
        const { generation, developed, repaired } = await askDevelopment(app, job, {
          vibeId: track.vibeId,
          vibeRevisionId: revision.id,
          queue,
          messages: built.messages,
          ask: { seconds, constraints, recordings, ends },
          progress: { done: i, of },
        });
        written.push({ genome: developed, generationId: generation.id, repaired });
      }
      // Where each part starts on its sketch, which Play the plain sketch puts it at: the first
      // goes on from where the outgoing section ends, and the second leads into where the
      // incoming one starts. Held inside the sketch, as a section's offset must be.
      const offsets = plan.parts.map(({ seconds }, i) => {
        if (of === 2 && i === 1) {
          return Math.max(0, onSketch(app, into, into.offset) - seconds);
        }
        const at = onSketch(app, out, out.offset + out.seconds);
        const { duration } = /** @type {(typeof sketches)[number]} */ (sketches[0]).genome;
        return at < duration ? at : Math.max(0, duration - seconds);
      });
      const developments = transaction(store, () =>
        written.map(({ genome, generationId }, i) => {
          const sketch = /** @type {(typeof sketches)[number]} */ (sketches[of === 2 ? i : 0]);
          return addDevelopment(store, {
            trackId: track.id,
            sketchId: sketch.id,
            text,
            offset: /** @type {number} */ (offsets[i]),
            seconds: /** @type {{ seconds: number }} */ (plan.parts[i]).seconds,
            genomeId: putGenome(store, track.vibeId, genome).id,
            seed: sketch.seed,
            generationId,
            bridge: true,
          });
        }),
      );
      job.progress(of, of, null);
      return {
        developmentIds: developments.map(({ id }) => id),
        trackId: track.id,
        revisionId,
        transition: index,
        plan,
        generationIds: written.map(({ generationId }) => generationId),
        repaired: written.map(({ repaired }) => repaired),
      };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

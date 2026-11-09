// Writes a bridge for one join of a track (decision 0081): the develop operator (0079) once,
// or once per half when the two sections differ in a join global, each request read from the
// two sections' stored rows with both neighbors as fixed ends, its answer held to the bridge's
// end rules with one repair round. The second half is written from the first one's answer. Every
// part is stored as the track's development, marked a bridge, in one transaction once all are
// written, so a cancel or a failure stores none. Nothing is rendered, and the timeline puts the
// bridge between the two sections. It runs only when the owner's route adds it.
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { BridgePart, BridgePlan } from "../domain/bridge-plan.js" */
/** @import { BridgeEdge, BridgeEnds } from "../domain/check-bridge.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { MORPH_CURVE } from "../domain/arrangement-schema.js";
import { BRIDGE_PART } from "../domain/bridge-plan.js";
import { sharedGlobals } from "../domain/check-bridge.js";
import { buildDevelopPrompt } from "../domain/develop-prompt.js";
import { BRIDGE_STATE_TOKENS, MEETING_EDGE, meetingState } from "../domain/meeting-state.js";
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
 * The job that writes a bridge and stores its parts.
 * @param {App} app
 * @param {BridgeRequest} request
 * @returns {(job: JobContext) => Promise<{ developmentIds: number[], trackId: number,
 *   revisionId: number, transition: number, plan: BridgePlan, generationIds: number[],
 *   repaired: boolean[] }>}
 */
export function bridgeJob(app, { track, revisionId, arrangement, index, plan }) {
  return async (job) => {
    const { store, config } = app;
    const queue = ownedBy(app.queue, job.signal);
    const cancelRequests = () => queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      const of = plan.parts.length;
      job.progress(0, of, JOB_STEP.readingBridge);
      const out = /** @type {Section} */ (arrangement.sections[index]);
      const into = /** @type {Section} */ (arrangement.sections[index + 1]);
      const text = /** @type {{ text: string }} */ (arrangement.transitions[index]).text;
      const { genomes } = sectionSources(store, arrangement);
      const outgoing = fittedGenome(arrangement, index, genomes);
      const incoming = fittedGenome(arrangement, index + 1, genomes);
      const sketches = [readSketch(app, out.sketchId), readSketch(app, into.sketchId)];
      const recordings = new Set(
        sketches.flatMap(({ genome }) => recordingRefs(genome).map(({ hash }) => hash)),
      );
      const held = sharedGlobals(outgoing, incoming);
      const { revision, constraints, ranges } = currentRevision(store, track.vibeId);
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
      /** @type {{ genome: Genome, generationId: number, repaired: boolean }[]} */
      const written = [];
      for (const [i, { seconds }] of plan.parts.entries()) {
        /** @type {BridgePart} */
        const part =
          of === 1 ? BRIDGE_PART.whole : i === 0 ? BRIDGE_PART.first : BRIDGE_PART.second;
        const second = part === BRIDGE_PART.second;
        const middle = /** @type {number} */ (plan.middle);
        const previous = written[i - 1];
        /** @type {BridgeEnds} */
        const ends = {
          start: previous
            ? {
                genome: previous.genome,
                at: previous.genome.duration,
                name: `section ${from + 1}`,
                globals: false,
                through: middle,
                weave: null,
              }
            : start,
          end: part === BRIDGE_PART.first ? null : end,
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
          before: state(ends.start, true),
          after: state(ends.end, false),
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
          budgetTokens: Math.floor(config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
        });
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

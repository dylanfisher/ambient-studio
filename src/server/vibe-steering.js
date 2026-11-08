// A vibe's directions and attached regions as a steer and the session page read them (decision
// 0056): each direction's vector from its ends' text embeddings (through `embedText`'s cache),
// the brief's own text standing in for a near end left empty; each region's embedding at
// the brief's loudness; and each one's scale over the vibe's excerpts.
/** @import { SteerDirection, Steering, SteerRegion } from "../domain/steer-terms.js" */
/** @import { Scale } from "../domain/vibe-scale.js" */
/** @import { TextEmbedder } from "./retrieve-examples.js" */
/** @import { Store } from "./store.js" */
import { ATTACHMENT_KIND, NEUTRAL_NEAR_TEXT } from "../domain/attachment-kind.js";
import { directionVector, projection } from "../domain/direction-vector.js";
import { EXCERPT_SECONDS } from "../domain/excerpt-seconds.js";
import { regionSimilarity } from "../domain/steer-terms.js";
import {
  MIN_SCALE_EXCERPTS,
  MIN_SCALE_SPAN,
  scaledPosition,
  vibeScale,
} from "../domain/vibe-scale.js";
import { listAttachments } from "./attachment-store.js";
import { vectorFloats, vibeExcerptEmbeddings } from "./embedding-store.js";
import { currentRevision } from "./generate-candidates.js";
import { PRODUCER } from "./producer.js";
import { getRegion } from "./reference-store.js";
import { findRegionAnalysis } from "./region-analysis-store.js";
import { vibeLoudness } from "./render-excerpt.js";

/**
 * One direction or region as read: its vector and scale, or why a steer can't use it.
 * @typedef {object} SteerAxis
 * @property {number} id the attachment's
 * @property {Float32Array | null} vector
 * @property {Scale | null} scale null when `reason` is set
 * @property {string | null} reason why it has no vector or scale yet, or null when it has both
 */

/**
 * @typedef {SteerAxis & { near: string | null, far: string }} VibeDirection
 * @typedef {SteerAxis & { regionId: number, label: string }} VibeRegion
 */

/** @typedef {{ renderId: number, vector: Float32Array }} SteerExcerpt */

/**
 * @typedef {object} VibeSteering
 * @property {SteerExcerpt[]} excerpts the vibe's, with their embeddings under the embedder's
 *   producer
 * @property {VibeDirection[]} directions live, oldest first
 * @property {VibeRegion[]} regions the live reference attachments, oldest first
 */

/** Why an axis has no scale: fewer than two excerpts, or excerpts that all read alike. */
const NO_SCALE = `a scale needs at least ${MIN_SCALE_EXCERPTS} excerpts of this brief with their sound analyzed, at least ${MIN_SCALE_SPAN} apart on it`;

/**
 * The text a direction with no near end starts from: the brief's description, or
 * `NEUTRAL_NEAR_TEXT` when it is empty.
 * @param {string} brief
 */
export const nearTextOf = (brief) => (brief.trim() === "" ? NEUTRAL_NEAR_TEXT : brief);

/**
 * The scale of `vector` over the excerpts, read by `value`, or the reason there is none.
 * @param {readonly SteerExcerpt[]} excerpts
 * @param {Float32Array} vector
 * @param {(embedding: Float32Array, vector: Float32Array) => number} value
 */
function scaleOf(excerpts, vector, value) {
  const scale = vibeScale(excerpts.map((excerpt) => value(excerpt.vector, vector)));
  return { vector, scale, reason: scale === null ? NO_SCALE : null };
}

/**
 * Reads the vibe's directions and regions under the embedder's producer. A sidecar failure while
 * embedding an end throws, naming the direction.
 * @param {Store} store
 * @param {number} vibeId
 * @param {TextEmbedder} embedder
 * @returns {Promise<VibeSteering>}
 */
export async function readSteering(store, vibeId, embedder) {
  const { revision, constraints } = currentRevision(store, vibeId);
  const target = vibeLoudness(constraints);
  const excerpts = vibeExcerptEmbeddings(store, {
    vibeId,
    target,
    duration: EXCERPT_SECONDS,
    renderProducer: PRODUCER,
    producer: embedder.producer,
  });
  /** @type {VibeDirection[]} */
  const directions = [];
  for (const { id, details } of listAttachments(store, vibeId, ATTACHMENT_KIND.direction)) {
    // The store checked the details when it added the row.
    const { near, far } = /** @type {{ near: string | null, far: string }} */ (details);
    const named = `direction ${id} (${JSON.stringify(near ?? "the brief")} to ${JSON.stringify(far)})`;
    const farVector = await embedder.embedText(far, `the far end of ${named}`);
    // With no near end, the brief's own text, which 4h embeds through the same cache: both ends
    // are then text, so CLAP's offset between text and audio cancels in the difference.
    const nearVector =
      near === null
        ? await embedder.embedText(
            nearTextOf(revision.brief),
            `the brief, the near end of ${named}`,
          )
        : await embedder.embedText(near, `the near end of ${named}`);
    directions.push({
      id,
      near,
      far,
      ...scaleOf(excerpts, directionVector(nearVector, farVector), projection),
    });
  }
  /** @type {VibeRegion[]} */
  const regions = [];
  for (const { id, regionId } of listAttachments(store, vibeId, ATTACHMENT_KIND.reference)) {
    const region = getRegion(store, /** @type {number} */ (regionId));
    if (!region) throw new Error(`attachment ${id} names region ${regionId}, which has no row`);
    const analysis = findRegionAnalysis(store, { regionId: region.id, target, producer: PRODUCER });
    const named = { id, regionId: region.id, label: region.label };
    if (analysis?.embedding == null || analysis.embeddingProducer !== embedder.producer) {
      regions.push({
        ...named,
        vector: null,
        scale: null,
        reason: `its sound has no analysis at this brief's loudness, ${target} LUFS, under the current sound-analysis model; press Measure on the brief page`,
      });
      continue;
    }
    regions.push({
      ...named,
      ...scaleOf(excerpts, vectorFloats(analysis.embedding), regionSimilarity),
    });
  }
  return { excerpts, directions, regions };
}

/**
 * Each excerpt's position on the axis, by render id; none when the axis has no scale.
 * @param {readonly SteerExcerpt[]} excerpts
 * @param {SteerAxis} axis
 * @param {(embedding: Float32Array, vector: Float32Array) => number} value
 * @returns {Record<number, number>}
 */
function positionsOn(excerpts, { vector, scale }, value) {
  if (vector === null || scale === null) return {};
  return Object.fromEntries(
    excerpts.map((excerpt) => [
      excerpt.renderId,
      scaledPosition(value(excerpt.vector, vector), scale),
    ]),
  );
}

/**
 * What the session page shows: each direction's and region's reason, if any, and each
 * excerpt's position on it by render id.
 * @param {VibeSteering} steering
 */
export function steeringView({ excerpts, directions, regions }) {
  return {
    excerpts: excerpts.length,
    directions: directions.map(({ id, near, far, reason, ...axis }) => ({
      id,
      near,
      far,
      reason,
      positions: positionsOn(excerpts, { id, reason, ...axis }, projection),
    })),
    regions: regions.map(({ id, regionId, label, reason, ...axis }) => ({
      id,
      regionId,
      label,
      reason,
      positions: positionsOn(excerpts, { id, reason, ...axis }, regionSimilarity),
    })),
  };
}

/**
 * A steer's choices.
 * @typedef {object} SteerChoices
 * @property {{ id: number, setting: number }[]} directions direction attachments with their
 *   sliders' settings
 * @property {number[]} regions reference attachments to steer toward
 */

/**
 * The steering the choices name, or the reason one of them can't be steered by, naming it.
 * Choices name live attachments of the vibe; the route checks that.
 * @param {VibeSteering} steering
 * @param {SteerChoices} choices
 * @returns {Steering | string}
 */
export function chosenSteering(steering, choices) {
  /** @type {SteerDirection[]} */
  const directions = [];
  /** @type {SteerRegion[]} */
  const regions = [];
  for (const { id, setting } of choices.directions) {
    const found = steering.directions.find((direction) => direction.id === id);
    if (!found) return `direction ${id} isn't attached to this brief any more`;
    if (found.vector === null || found.scale === null) {
      return `The direction from “${found.near ?? "this brief's excerpts"}” to “${found.far}” can't be steered by yet: ${found.reason}.`;
    }
    directions.push({ vector: found.vector, scale: found.scale, setting });
  }
  for (const id of choices.regions) {
    const found = steering.regions.find((region) => region.id === id);
    if (!found) return `region attachment ${id} isn't attached to this brief any more`;
    if (found.vector === null || found.scale === null) {
      return `The region “${found.label}” can't be steered toward yet: ${found.reason}.`;
    }
    regions.push({ vector: found.vector, scale: found.scale });
  }
  return { directions, regions };
}

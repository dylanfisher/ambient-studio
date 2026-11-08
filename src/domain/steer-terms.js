// The terms a steer adds to the search score (decision 0056): for each direction, how far a
// sound's position sits from the slider's setting, and for each region chosen as "toward this
// region", how near it sits to the region. Both are read on the vibe's scale, so a term's unit is
// the spread of the vibe's excerpts, and the weights put the model's score small beside them.
/** @import { ScoreTerm } from "./search-score.js" */
/** @import { Scale } from "./vibe-scale.js" */
import { projection } from "./direction-vector.js";
import { meanSimilarity } from "./mean-similarity.js";
import { scaledPosition } from "./vibe-scale.js";

/**
 * A direction term's weight against the model score's 1: a sound one tenth of the vibe's spread
 * from the setting costs as much as one unit of the taste model's score.
 */
export const DIRECTION_WEIGHT = 10;
/** A region term's weight, the same as a direction's, so a slider and a region pull alike. */
export const REGION_WEIGHT = 10;

/**
 * @typedef {object} SteerDirection
 * @property {ArrayLike<number>} vector from `directionVector`
 * @property {Scale} scale of the vibe's excerpts' projections on it
 * @property {number} setting the slider's, from 0 (the vibe's least) to 1 (its most)
 */

/**
 * @typedef {object} SteerRegion
 * @property {ArrayLike<number>} vector the region's embedding
 * @property {Scale} scale of the vibe's excerpts' cosine similarities to it
 */

/**
 * @typedef {object} Steering
 * @property {readonly SteerDirection[]} directions
 * @property {readonly SteerRegion[]} regions
 */

/**
 * The cosine similarity of a sound to a region, which the region's scale is read on.
 * @param {ArrayLike<number>} embedding
 * @param {ArrayLike<number>} region
 */
export const regionSimilarity = (embedding, region) =>
  meanSimilarity([Float32Array.from(embedding)], Float32Array.from(region));

/**
 * One term per direction, the negated distance of the sound's position from its setting, then
 * one per region, the sound's position on the region's scale.
 * @param {ArrayLike<number>} embedding the sound's
 * @param {Steering} steering
 * @returns {ScoreTerm[]}
 */
export function steerTerms(embedding, { directions, regions }) {
  return [
    ...directions.map(({ vector, scale, setting }) => ({
      value: -Math.abs(scaledPosition(projection(embedding, vector), scale) - setting),
      weight: DIRECTION_WEIGHT,
    })),
    ...regions.map(({ vector, scale }) => ({
      value: scaledPosition(regionSimilarity(embedding, vector), scale),
      weight: REGION_WEIGHT,
    })),
  ];
}

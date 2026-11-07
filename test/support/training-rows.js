// Rating and feedback rows as the store returns them, made by hand for training-set tests
// (decision 0043), so no test renders an excerpt to get one.
/** @import { Features } from "../../src/domain/extract-features.js" */

/** The heard window every row here names. */
const WINDOW = { seed: 7, offset: 12.5, duration: 25, engineVersion: 2 };

/**
 * An A/B rating of rated audio `a` (genome `aGenomeId`) against rated audio `b`.
 * @param {{ id: number, outcome: "a" | "b" | "tie" | "skip", leftSide?: "a" | "b",
 *   sessionId?: number, a?: number, b?: number, aGenomeId?: number, bGenomeId?: number,
 *   removedAt?: number | null, removedReason?: string | null }} fields
 */
export function rating({
  id,
  outcome,
  leftSide = "a",
  sessionId = 1,
  a = 11,
  b = 12,
  aGenomeId = 1,
  bGenomeId = 2,
  removedAt = null,
  removedReason = null,
}) {
  /** @param {number} ratedAudioId @param {number} genomeId */
  const side = (ratedAudioId, genomeId) => ({
    ...WINDOW,
    genomeId,
    ratedAudioId,
    playedFraction: 1,
    rank: null,
    score: null,
    modelVersion: null,
    wildcard: null,
  });
  return {
    id,
    sessionId,
    vibeRevisionId: 1,
    a: side(a, aGenomeId),
    b: side(b, bGenomeId),
    leftSide,
    orderSeed: 0,
    outcome,
    timeTakenMs: 1000,
    createdAt: id,
    removedAt,
    removedReason,
  };
}

/**
 * Thumbs on rated audio `ratedAudioId`, or macro feedback when `kind` is `macro`.
 * @param {{ id: number, direction?: string, kind?: "thumbs" | "macro", macro?: string | null,
 *   sessionId?: number, ratedAudioId?: number, genomeId?: number,
 *   removedAt?: number | null, removedReason?: string | null }} fields
 */
export function thumbs({
  id,
  direction = "up",
  kind = "thumbs",
  macro = null,
  sessionId = 1,
  ratedAudioId = 11,
  genomeId = 1,
  removedAt = null,
  removedReason = null,
}) {
  return {
    ...WINDOW,
    id,
    sessionId,
    vibeRevisionId: 1,
    genomeId,
    ratedAudioId,
    playedFraction: 1,
    timeTakenMs: 1000,
    kind,
    direction,
    note: null,
    macro,
    macroValue: macro === null ? null : { min: 0.5, max: 0.5, mean: 0.5 },
    createdAt: id,
    removedAt,
    removedReason,
  };
}

/**
 * Features for each rated audio id, its spectral centroid 100 Hz times the id so a test can
 * tell the sides apart.
 * @param {number[]} ratedAudioIds
 * @returns {Map<number, Features>}
 */
export function features(ratedAudioIds) {
  return new Map(
    ratedAudioIds.map((id) => [
      id,
      {
        raw: { loudness: -16, shortTermMax: -12, loudnessRange: 4, truePeak: -2 },
        heard: {
          gainDb: 0,
          centroidMean: 100 * id,
          centroidSpread: 200,
          onsetRate: 0.5,
          lowEndShare: 0.3,
          stereoWidth: 0.4,
          flatness: 0.1,
        },
      },
    ]),
  );
}

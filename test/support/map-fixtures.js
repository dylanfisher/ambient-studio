// Candidates with current excerpts, seeded in the store with scripted features and an MP3 file
// that holds nothing, for the map's tests (decision 0057): the archive reads stored renders, so
// nothing is rendered.
/** @import { Paths } from "../../src/config/paths.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { Store } from "../../src/server/store.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { addCandidate, getGenome, putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { putRender } from "../../src/server/render-store.js";

/** The drone, a genome that passes `VIBE`'s constraints, with no macro trajectories. */
const MAP_GENOME = requireGenome(droneGenome, "the drone genome");

/** The seed every seeded candidate is heard at. */
const MAP_SEED = 7;

/**
 * Features as `extractFeatures` stores them, with the heard ones given.
 * @param {Record<string, number>} heard
 */
const mapFeatures = (heard) => ({
  raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -3 },
  heard: {
    gainDb: 0,
    centroidMean: 500,
    centroidSpread: 40,
    onsetRate: 0.2,
    lowEndShare: 0.4,
    stereoWidth: 0.3,
    flatness: 0.1,
    ...heard,
  },
});

/**
 * Stores the excerpt of `genome` at `MAP_SEED` as its current one: a render row under this
 * server's producer at `target`, at the offset the candidate is heard from, and its file.
 * @param {Store} store
 * @param {Paths} paths
 * @param {{ genomeId: number, target: number, heard: Record<string, number> }} excerpt
 */
export async function seedMapRender(store, paths, { genomeId, target, heard }) {
  const genome = requireGenome(getGenome(store, genomeId)?.genome, `genome ${genomeId}`);
  const file = `map-${genomeId}.mp3`;
  await mkdir(paths.renderCache, { recursive: true });
  await writeFile(join(paths.renderCache, file), "");
  return putRender(store, {
    genomeId,
    seed: MAP_SEED,
    offset: excerptOffset(genome, MAP_SEED, EXCERPT_SECONDS),
    duration: EXCERPT_SECONDS,
    target,
    producer: PRODUCER,
    file,
    features: mapFeatures(heard),
    checks: {},
  }).render;
}

/**
 * A candidate of the session with `genome` and, unless it is rejected, its excerpt.
 * @param {Store} store
 * @param {Paths} paths
 * @param {object} seeded
 * @param {number} seeded.vibeId
 * @param {number} seeded.vibeRevisionId
 * @param {number | null} seeded.sessionId
 * @param {number} seeded.target the revision's loudness
 * @param {Genome} seeded.genome
 * @param {Record<string, number>} [seeded.heard] features that differ from `mapFeatures`'
 * @param {string | null} [seeded.intent]
 * @param {boolean} [seeded.rejected]
 * @returns {Promise<Candidate>}
 */
export async function seedMapCandidate(store, paths, seeded) {
  const { vibeId, vibeRevisionId, sessionId, target, genome } = seeded;
  const { heard = {}, intent = "seeded", rejected = false } = seeded;
  const row = putGenome(store, vibeId, genome);
  if (!rejected) await seedMapRender(store, paths, { genomeId: row.id, target, heard });
  return addCandidate(store, {
    generationId: null,
    vibeRevisionId,
    sessionId,
    genomeId: rejected ? null : row.id,
    seed: MAP_SEED,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent,
    rejectReason: rejected ? REJECT_REASON.lintErrors : null,
    lint: null,
    rejectedGenome: rejected ? genome : null,
  });
}

/**
 * The drone with its motion macro at `motion` and its brightness at `brightness`.
 * @param {number} motion
 * @param {number} [brightness]
 * @returns {Genome}
 */
export const mapGenome = (motion, brightness = 0.5) => ({
  ...MAP_GENOME,
  macros: { ...MAP_GENOME.macros, motion, brightness },
});

// A kept sketch written straight to a studio's store, with no session, generation or render,
// for the track tests that develop or bridge its sections.
/** @import { Studio } from "./studio.js" */
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { addSketch } from "../../src/server/rating-store.js";

/** The seed every seeded sketch's candidate has. */
export const SKETCH_SEED = 11;

/**
 * @param {Studio} studio
 * @param {{ id: number, revision: { id: number } }} vibe as the vibe route returns it
 * @param {object} genome
 * @param {string | null} [intent]
 */
export function seedSketch({ server }, vibe, genome, intent = null) {
  const candidate = addCandidate(server.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(server.store, vibe.id, genome).id,
    seed: SKETCH_SEED,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return addSketch(server.store, { candidateId: candidate.id, notes: "", tags: [] });
}

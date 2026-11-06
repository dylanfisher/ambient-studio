// A store in a temp data root (decision 0021), with a clock that counts, so stored times are
// the same on every run. `fillStore` writes one row to every irreplaceable table.
/** @import { Paths } from "../../src/config/paths.js" */
/** @import { IrreplaceableTable, Store } from "../../src/server/store.js" */
import { loadConfig } from "../../src/config/config.js";
import { paths } from "../../src/config/paths.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { addEvaluation } from "../../src/server/evaluation-store.js";
import { addCandidate, addGeneration, putGenome } from "../../src/server/generation-store.js";
import { addFeedback, addRatedAudio, addRating, addSketch } from "../../src/server/rating-store.js";
import { startSession, stopSession } from "../../src/server/session-store.js";
import { openStore } from "../../src/server/store.js";
import { addNote, createVibe } from "../../src/server/vibe-store.js";
import { tempRoot } from "./temp-root.js";

/** The first time the test clock gives, 2026-11-06T00:00:00Z; each call adds a second. */
const START = Date.UTC(2026, 10, 6);

/**
 * @typedef {object} TempStore
 * @property {Store} store open on `paths.database`
 * @property {Paths} paths the temp root's folders
 * @property {string} configPath the temp root's config file
 * @property {() => number} now the clock the store was opened with
 * @property {() => Store} reopen closes the store and opens it again on the same file and clock
 * @property {() => Promise<void>} remove closes the store and deletes the temp root
 */

/** @returns {Promise<TempStore>} */
export async function tempStore() {
  const root = await tempRoot();
  const dataPaths = paths(loadConfig(root.configPath).dataRoot);
  let ticks = 0;
  const now = () => START + 1000 * ticks++;
  const made = {
    store: openStore(dataPaths.database, { now }),
    paths: dataPaths,
    configPath: root.configPath,
    now,
    reopen() {
      made.store.close();
      made.store = openStore(dataPaths.database, { now });
      return made.store;
    },
    async remove() {
      if (made.store.db.isOpen) made.store.close();
      await root.remove();
    },
  };
  return made;
}

/**
 * The heard identity of the drone genome's first excerpt.
 * @param {number} genomeId
 */
export const heardExcerpt = (genomeId) => ({
  genomeId,
  seed: 7,
  offset: 12.5,
  duration: 25,
  engineVersion: 2,
});

/**
 * Writes one row to every irreplaceable table, through the store's functions.
 * @param {Store} store
 * @returns {Record<IrreplaceableTable, number>} the id written, by table
 */
export function fillStore(store) {
  const vibe = createVibe(store, {
    name: "cold drone",
    brief: "slow, cold, D dorian",
    constraints: { tuning: "12tet" },
    softTargets: {},
  });
  const vibeRevisionId = vibe.revision.id;
  const note = addNote(store, { vibeId: vibe.id, text: "less shimmer" });
  const session = startSession(store, vibe.id);
  const stop = stopSession(store, session.id);
  const generation = addGeneration(store, {
    vibeRevisionId,
    sessionId: session.id,
    requestGroup: "group-1",
    prompt: [{ role: "user", content: "a drone" }],
    exampleIds: [],
    retrievalMethod: "rating-recency",
    model: "test-model",
    sampling: { temperature: 0.8, seed: 3 },
    response: "{}",
    finishReason: "stop",
    repairRound: 0,
    repairsId: null,
    latencyMs: 1200,
    firstTokenMs: 300,
    promptTokens: 900,
    completionTokens: 400,
  });
  const genome = putGenome(store, vibe.id, droneGenome);
  const candidate = addCandidate(store, {
    vibeRevisionId,
    generationId: generation.id,
    genomeId: genome.id,
    seed: 7,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: "a slow cold drone",
    rejectReason: null,
    lint: { ok: true, findings: [] },
  });
  const heard = heardExcerpt(genome.id);
  const ratedAudio = addRatedAudio(store, {
    ...heard,
    target: -16,
    file: "drone-7.flac",
    pcmSha256: "0".repeat(64),
    gainDb: -3.5,
  });
  const side = { ...heard, ratedAudioId: ratedAudio.id, playedFraction: 0.8 };
  const rating = addRating(store, {
    sessionId: session.id,
    vibeRevisionId,
    a: { ...side, rank: null, score: null, modelVersion: null, wildcard: null },
    b: { ...side, playedFraction: 1, rank: null, score: null, modelVersion: null, wildcard: null },
    leftSide: "b",
    orderSeed: 11,
    outcome: "tie",
    timeTakenMs: 9000,
  });
  const feedback = addFeedback(store, {
    sessionId: session.id,
    vibeRevisionId,
    ...heard,
    ratedAudioId: ratedAudio.id,
    playedFraction: 0.5,
    timeTakenMs: 4000,
    kind: "thumbs",
    direction: "up",
    note: "warm",
    macro: null,
    macroValue: null,
  });
  const sketch = addSketch(store, { candidateId: candidate.id, notes: "keep", tags: ["cold"] });
  const evaluation = addEvaluation(store, { params: { count: 1 }, report: { valid: 1 } });
  return {
    vibes: vibe.id,
    vibe_revisions: vibeRevisionId,
    notes: note.id,
    session_events: stop.id,
    generations: generation.id,
    genomes: genome.id,
    candidates: candidate.id,
    rated_audio: ratedAudio.id,
    ratings: rating.id,
    feedback: feedback.id,
    sketches: sketch.id,
    evaluations: evaluation.id,
  };
}

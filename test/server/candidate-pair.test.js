// Which card of a revised pair the session shows (decision 0036), through the candidates route:
// the one with fewer misses, the revision on a tie. Candidates, generations and renders are
// written to the store with the features each case needs, since the rule reads only the stored
// measurements; candidate-job.test.js covers making them.
/** @import { Studio } from "../support/studio.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { addCandidate, addGeneration, putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { putRender } from "../../src/server/render-store.js";
import { GENOMES, removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/** Two ranges, so a candidate can miss none, one or both. */
const RANGED = {
  ...VIBE,
  softTargets: { features: { lowEndShare: [null, 0.5], stereoWidth: [0.2, null] } },
};
/** @type {import("../../src/domain/lint-result.js").LintResult} */
const PASSING = { ok: true, findings: [] };

/**
 * Features with the given low-end share and width; the rest sit outside every range here.
 * @param {number} lowEndShare
 * @param {number} stereoWidth
 */
const features = (lowEndShare, stereoWidth) => ({
  raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -4 },
  heard: {
    gainDb: 4,
    centroidMean: 900,
    centroidSpread: 200,
    onsetRate: 0.2,
    lowEndShare,
    stereoWidth,
    flatness: 0.01,
  },
});

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const { server, ok } = studio;
  const vibe = await ok("POST", "/api/vibes", RANGED);
  const session = await ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
  const { store, paths } = server;

  /**
   * A candidate of the session with a generation, and an excerpt measured as `measured` unless
   * it is null.
   * @param {{ genome: unknown, seed: number, measured: object | null, checks?: object,
   *   operator?: string, parentIds?: number[], operatorParams?: object | null,
   *   rejectReason?: string }} spec
   */
  async function seed({ genome, seed, measured, checks = PASSING, ...lineage }) {
    const generation = addGeneration(store, {
      vibeRevisionId: vibe.revision.id,
      sessionId: session.id,
      requestGroup: `seeded-${seed}`,
      prompt: [],
      exampleIds: [],
      retrievalMethod: "rating-recency",
      model: "fake",
      sampling: {},
      response: "",
      finishReason: "stop",
      repairRound: 0,
      repairsId: null,
      latencyMs: 1,
      firstTokenMs: null,
      promptTokens: null,
      completionTokens: null,
      reasoning: null,
      requestParams: null,
      retries: null,
      error: null,
    });
    const rejected = lineage.rejectReason !== undefined;
    const genomeId = rejected ? null : putGenome(store, vibe.id, genome).id;
    const candidate = addCandidate(store, {
      vibeRevisionId: vibe.revision.id,
      generationId: generation.id,
      genomeId,
      seed,
      source: "llm",
      parentIds: lineage.parentIds ?? [],
      locks: [],
      operator: lineage.operator ?? null,
      operatorParams: lineage.operatorParams ?? null,
      intent: "seeded",
      rejectReason: lineage.rejectReason ?? null,
      lint: null,
      rejectedGenome: null,
    });
    if (measured !== null && genomeId !== null) {
      const duration = EXCERPT_SECONDS;
      const offset = excerptOffset(/** @type {any} */ (genome), seed, duration);
      const file = `seeded-${candidate.id}.wav`;
      await mkdir(paths.renderCache, { recursive: true });
      await writeFile(join(paths.renderCache, file), "");
      const key = { genomeId, seed, offset, duration, target: -16, producer: PRODUCER };
      putRender(store, { ...key, file, features: measured, checks });
    }
    return candidate;
  }

  /**
   * A first try and its revision, each measured as given, and the route's list.
   * @param {object | null} first
   * @param {object | null} revised
   */
  async function pair(first, revised, { checks = PASSING } = {}) {
    const firstTry = await seed({ genome: GENOMES[0], seed: 1, measured: first });
    const revision = await seed({
      genome: GENOMES[1],
      seed: 2,
      measured: revised,
      checks,
      operator: "revise",
      parentIds: [firstTry.id],
      operatorParams: { unchanged: false },
    });
    const { candidates } = await ok("GET", `/api/sessions/${session.id}/candidates`);
    return { firstTry, revision, candidates };
  }
  return { ...studio, seed, pair, session };
}

test("the revision is shown when it misses fewer ranges", async () => {
  const { pair } = await setup();
  const { firstTry, revision, candidates } = await pair(features(0.8, 0.1), features(0.4, 0.1));
  const expected = { firstTryId: firstTry.id, revisionId: revision.id, shownId: revision.id };
  expect(candidates.map((/** @type {any} */ c) => [c.id, c.pair])).toEqual([
    [firstTry.id, expected],
    [revision.id, expected],
  ]);
  expect(candidates[1]).toMatchObject({ operator: "revise", parentIds: [firstTry.id] });
});

test("the first try is shown when the revision misses more", async () => {
  const { pair } = await setup();
  const { firstTry, candidates } = await pair(features(0.4, 0.1), features(0.8, 0.1));
  expect(candidates[0].pair.shownId).toBe(firstTry.id);
});

test("the revision is shown on a tie", async () => {
  const { pair } = await setup();
  const { revision, candidates } = await pair(features(0.8, 0.3), features(0.4, 0.1));
  expect(candidates[0].pair.shownId).toBe(revision.id);
});

test("a failed render check counts as a miss", async () => {
  const { pair } = await setup();
  const clipping = { ok: false, findings: [{ path: "$", rule: "clipping", message: "clips" }] };
  // One range miss each, and the revision clips: without the check it would be a tie.
  const { firstTry, candidates } = await pair(features(0.8, 0.3), features(0.8, 0.3), {
    checks: clipping,
  });
  expect(candidates[0].pair.shownId).toBe(firstTry.id);
});

test("the first try is shown until the revision's excerpt is measured", async () => {
  const { pair } = await setup();
  const { firstTry, candidates } = await pair(features(0.8, 0.1), null);
  expect(candidates[0].pair.shownId).toBe(firstTry.id);
});

test("an unchanged revision is left out, and a rejected one makes no pair", async () => {
  const { seed, ok, session } = await setup();
  const firstTry = await seed({ genome: droneGenome, seed: 1, measured: features(0.8, 0.1) });
  await seed({
    genome: droneGenome,
    seed: 1,
    measured: null,
    operator: "revise",
    parentIds: [firstTry.id],
    operatorParams: { unchanged: true },
  });
  const rejected = await seed({
    genome: null,
    seed: 3,
    measured: null,
    operator: "revise",
    parentIds: [firstTry.id],
    rejectReason: "lintErrors",
  });
  const { candidates } = await ok("GET", `/api/sessions/${session.id}/candidates`);
  expect(candidates.map((/** @type {any} */ c) => [c.id, c.pair])).toEqual([
    [firstTry.id, null],
    [rejected.id, null],
  ]);
});

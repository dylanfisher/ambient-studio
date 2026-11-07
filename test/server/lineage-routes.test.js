// A vibe's lineage through its route (decision 0039): every session candidate with its parents,
// evaluation and control-arm candidates left out, unchanged revisions folded into their first
// try. Rows are written to the store, since the route reads only what is stored; the jobs that
// make them are tested in their own files.
/** @import { Studio } from "../support/studio.js" */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addFeedback, addRatedAudio, addSketch } from "../../src/server/rating-store.js";
import { putRender } from "../../src/server/render-store.js";
import { REVISE_CONTROL } from "../../src/server/revise-candidate.js";
import { startSession } from "../../src/server/session-store.js";
import { GENOMES, removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/** Features as an excerpt is measured; `VIBE` gives no ranges, so nothing here misses. */
const FEATURES = {
  raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -4 },
  heard: {
    gainDb: 4,
    centroidMean: 900,
    centroidSpread: 200,
    onsetRate: 0.2,
    lowEndShare: 0.4,
    stereoWidth: 0.2,
    flatness: 0.01,
  },
};

/** A third genome, so three valid nodes each have one of their own. */
const GENOME_C = { ...GENOMES[0], reverbDecay: 6 };

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const { server, ok } = studio;
  const vibe = await ok("POST", "/api/vibes", VIBE);
  const { store, paths } = server;

  /**
   * A candidate of the vibe as a job would store it; a null genome is a rejected one.
   * @param {{ sessionId: number | null, genome: unknown, seed?: number, operator?: string | null,
   *   parentIds?: number[], operatorParams?: object | null, intent?: string | null }} spec
   */
  function seed({ sessionId, genome, seed = 1, ...lineage }) {
    const genomeId = genome === null ? null : putGenome(store, vibe.id, genome).id;
    return addCandidate(store, {
      vibeRevisionId: vibe.revision.id,
      generationId: null,
      sessionId,
      genomeId,
      seed,
      source: "llm",
      parentIds: lineage.parentIds ?? [],
      locks: [],
      operator: lineage.operator ?? null,
      operatorParams: lineage.operatorParams ?? null,
      intent: lineage.intent === undefined ? "seeded" : lineage.intent,
      rejectReason: genome === null ? "noJson" : null,
      lint: null,
      rejectedGenome: null,
    });
  }

  /**
   * An excerpt row and file for the candidate, so it is playable.
   * @param {{ genomeId: number | null, seed: number }} candidate
   * @param {unknown} genome
   */
  async function render({ genomeId, seed }, genome) {
    const duration = EXCERPT_SECONDS;
    const offset = excerptOffset(/** @type {any} */ (genome), seed, duration);
    const file = `seeded-${genomeId}-${seed}.mp3`;
    await mkdir(paths.renderCache, { recursive: true });
    await writeFile(join(paths.renderCache, file), "");
    const key = {
      genomeId: /** @type {number} */ (genomeId),
      seed,
      offset,
      duration,
      target: -16,
      producer: PRODUCER,
    };
    return putRender(store, {
      ...key,
      file,
      features: FEATURES,
      checks: { ok: true, findings: [] },
    }).render;
  }

  /**
   * A live thumbs choice on the candidate, as the thumbs route leaves it.
   * @param {number} sessionId
   * @param {{ genomeId: number | null, seed: number }} candidate
   * @param {"up" | "down"} direction
   */
  function thumbs(sessionId, { genomeId, seed }, direction) {
    const heard = {
      genomeId: /** @type {number} */ (genomeId),
      seed,
      offset: 0,
      duration: EXCERPT_SECONDS,
      engineVersion: ENGINE_VERSION,
    };
    const audio = addRatedAudio(store, {
      ...heard,
      target: -16,
      file: `rated-${genomeId}.wav`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
    return addFeedback(store, {
      ...heard,
      sessionId,
      vibeRevisionId: vibe.revision.id,
      ratedAudioId: audio.id,
      playedFraction: 1,
      timeTakenMs: 1000,
      kind: "thumbs",
      direction,
      note: null,
      macro: null,
      macroValue: null,
    });
  }
  return { ...studio, vibe, store, seed, render, thumbs };
}

/**
 * Three generations over two sessions, with an evaluation candidate, a control-arm candidate,
 * an unchanged revision and a rejected answer mixed in.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 */
async function scriptedTree(studio) {
  const { vibe, store, seed, render, thumbs } = studio;
  const one = startSession(store, vibe.id).id;
  const root = seed({ sessionId: one, genome: GENOMES[0] });
  const revision = seed({
    sessionId: one,
    genome: GENOMES[1],
    seed: 2,
    operator: "revise",
    parentIds: [root.id],
    operatorParams: { unchanged: false },
  });
  const unchanged = seed({
    sessionId: one,
    genome: GENOMES[0],
    operator: "revise",
    parentIds: [root.id],
    operatorParams: { unchanged: true },
  });
  const rejected = seed({ sessionId: one, genome: null, seed: 3, intent: null });
  const evaluation = seed({ sessionId: null, genome: GENOME_C, seed: 4 });
  const two = startSession(store, vibe.id).id;
  const control = seed({
    sessionId: two,
    genome: GENOME_C,
    seed: 5,
    operator: REVISE_CONTROL,
    parentIds: [root.id],
  });
  const nudged = seed({
    sessionId: two,
    genome: GENOME_C,
    seed: 2,
    operator: "nudge",
    parentIds: [revision.id],
    operatorParams: { stepSize: "small", seed: 9 },
    intent: null,
  });
  const explored = seed({
    sessionId: two,
    genome: { ...GENOME_C, reverbDecay: 7 },
    seed: 6,
    operator: "explore",
    parentIds: [unchanged.id],
    operatorParams: { direction: "slower", baseTrimmed: false },
  });
  const grandchild = seed({
    sessionId: two,
    genome: { ...GENOME_C, reverbDecay: 8 },
    seed: 2,
    operator: "nudge",
    parentIds: [nudged.id],
    operatorParams: { stepSize: "large", seed: 9 },
    intent: null,
  });
  const excerpt = await render(root, GENOMES[0]);
  thumbs(one, root, "up");
  addSketch(store, { candidateId: nudged.id, notes: "", tags: [] });
  return {
    sessions: { one, two },
    ids: { root, revision, unchanged, rejected, evaluation, control, nudged, explored, grandchild },
    excerpt,
  };
}

test("the lineage gives every valid session node with its parents and leaves the others out", async () => {
  const studio = await setup();
  const { sessions, ids, excerpt } = await scriptedTree(studio);
  const { nodes } = await studio.ok("GET", `/api/vibes/${studio.vibe.id}/lineage`);

  const { root, revision, nudged, explored, grandchild } = ids;
  expect(nodes.map((/** @type {any} */ n) => [n.id, n.parentIds, n.operator])).toEqual([
    [root.id, [], null],
    [revision.id, [root.id], "revise"],
    // Made in a later session, it still sits under the revision it came from.
    [nudged.id, [revision.id], "nudge"],
    // Its base was the unchanged revision, which is folded into its first try.
    [explored.id, [root.id], "explore"],
    [grandchild.id, [nudged.id], "nudge"],
  ]);
  const pair = { firstTryId: root.id, revisionId: revision.id, shownId: root.id };
  expect(nodes[0]).toMatchObject({
    sessionId: sessions.one,
    intent: "seeded",
    rejectReason: null,
    pair,
    excerpt: { renderId: excerpt.id, url: `/audio/${excerpt.id}`, duration: EXCERPT_SECONDS },
    marks: { thumbs: "up", compared: 0 },
    sketch: false,
  });
  expect(nodes[1]).toMatchObject({ pair, excerpt: null, marks: { thumbs: null } });
  expect(nodes[2]).toMatchObject({
    sessionId: sessions.two,
    intent: null,
    operatorParams: { stepSize: "small" },
    pair: null,
    sketch: true,
  });
  expect(nodes[3].operatorParams).toMatchObject({ direction: "slower", baseTrimmed: false });
});

test("rejected nodes are listed only when asked for", async () => {
  const studio = await setup();
  const { ids } = await scriptedTree(studio);
  const path = `/api/vibes/${studio.vibe.id}/lineage`;
  const { nodes } = await studio.ok("GET", `${path}?includeRejected=true`);
  const { root, revision, rejected, nudged, explored, grandchild } = ids;
  expect(nodes.map((/** @type {any} */ n) => n.id)).toEqual([
    root.id,
    revision.id,
    rejected.id,
    nudged.id,
    explored.id,
    grandchild.id,
  ]);
  expect(nodes[2]).toMatchObject({ rejectReason: "noJson", genomeId: null, excerpt: null });
  const { nodes: valid } = await studio.ok("GET", `${path}?includeRejected=false`);
  expect(valid).toHaveLength(5);
});

test("an unknown vibe is a 404, and a rejected flag that isn't true or false is a 400", async () => {
  const studio = await setup();
  const missing = await studio.server.api("GET", "/api/vibes/999/lineage");
  expect(missing.status).toBe(404);
  const bad = await studio.server.api(
    "GET",
    `/api/vibes/${studio.vibe.id}/lineage?includeRejected=1`,
  );
  expect(bad.status).toBe(400);
  expect(bad.json().error).toMatch(/includeRejected/);
});

// A vibe's directions and regions as the session page and a steer read them (decision 0056),
// with a scripted text embedder and seeded excerpt embeddings, so no test reaches the sidecar.
/** @import { Store } from "../../src/server/store.js" */
import { afterEach, expect, test } from "vitest";
import { ATTACHMENT_KIND } from "../../src/domain/attachment-kind.js";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { addAttachment } from "../../src/server/attachment-store.js";
import { putEmbedding } from "../../src/server/embedding-store.js";
import { putGenome } from "../../src/server/generation-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { addReferenceFile, addRegion } from "../../src/server/reference-store.js";
import { putRegionEmbedding, putRegionFeatures } from "../../src/server/region-analysis-store.js";
import { putRender } from "../../src/server/render-store.js";
import { chosenSteering, readSteering, steeringView } from "../../src/server/vibe-steering.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const CLAP = "clap-test";
const TARGET = -16;
/** Each text's scripted embedding. */
const TEXTS = /** @type {Record<string, number[]>} */ ({ dry: [1, 0], underwater: [0, 1] });
const embedder = {
  producer: CLAP,
  embedText: async (/** @type {string} */ text) => {
    const floats = TEXTS[text];
    if (!floats) throw new Error(`no scripted embedding for ${text}`);
    return Float32Array.from(floats);
  },
};

/**
 * A vibe at −16 LUFS with an excerpt for each vector, in order.
 * @param {Store} store
 * @param {number[][]} vectors
 */
function vibeWith(store, vectors) {
  const vibe = createVibe(store, {
    name: "steer",
    brief: "a drone",
    constraints: { loudness: TARGET },
    softTargets: {},
  });
  const renderIds = vectors.map((vector, i) => {
    const genome = { ...SEED_GENOMES["cold-dorian"], duration: 300 + i };
    const row = putGenome(store, vibe.id, genome);
    const { render } = putRender(store, {
      genomeId: row.id,
      seed: 1,
      offset: 0,
      duration: EXCERPT_SECONDS,
      target: TARGET,
      producer: PRODUCER,
      file: `r${i}.mp3`,
      features: {},
      checks: {},
    });
    putEmbedding(store, {
      ratedAudioId: null,
      renderId: render.id,
      producer: CLAP,
      vector: new Uint8Array(Float32Array.from(vector).buffer),
    });
    return render.id;
  });
  return { vibe, renderIds };
}

/** @param {Store} store @param {number} vibeId @param {string | null} near @param {string} far */
const direction = (store, vibeId, near, far) =>
  addAttachment(store, {
    vibeId,
    kind: ATTACHMENT_KIND.direction,
    regionId: null,
    details: { near, far },
  });

test("each excerpt's position orders it along the direction, 0 at the least and 1 at the most", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { vibe, renderIds } = vibeWith(made.store, [
    [0.6, 0.8],
    [1, 0],
    [0, 1],
  ]);
  const typed = direction(made.store, vibe.id, "dry", "underwater");
  const view = steeringView(await readSteering(made.store, vibe.id, embedder));
  expect(view.excerpts).toBe(3);
  const [shown] = view.directions;
  expect(shown).toMatchObject({ id: typed.id, near: "dry", far: "underwater", reason: null });
  const positions = /** @type {Record<number, number>} */ (shown?.positions);
  const [middle, least, most] = renderIds.map((id) => /** @type {number} */ (positions[id]));
  expect(least).toBe(0);
  expect(most).toBe(1);
  expect(middle).toBeGreaterThan(0);
  expect(middle).toBeLessThan(1);
});

test("with no near end, the direction runs from the mean of the vibe's excerpts", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { vibe } = vibeWith(made.store, [
    [1, 0],
    [0.8, 0.6],
  ]);
  direction(made.store, vibe.id, null, "underwater");
  const read = await readSteering(made.store, vibe.id, embedder);
  const vector = /** @type {Float32Array} */ (read.directions[0]?.vector);
  // The mean of [1, 0] and [0.8, 0.6] is [0.9, 0.3], unit [0.949, 0.316]; toward [0, 1] the
  // difference is [-0.949, 0.684], unit [-0.811, 0.585].
  expect(Array.from(vector, (v) => Number(v.toFixed(3)))).toEqual([-0.811, 0.585]);
});

test("fewer than two excerpts give no scale, and the reason; a region not analyzed under the embedder says so", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const { vibe } = vibeWith(store, [[1, 0]]);
  const typed = direction(store, vibe.id, "dry", "underwater");
  const empty = createVibe(store, {
    name: "empty",
    brief: "nothing yet",
    constraints: { loudness: TARGET },
    softTargets: {},
  });
  direction(store, empty.id, null, "underwater");
  const { reference } = addReferenceFile(store, {
    sha256: "c".repeat(64),
    fileName: "c.wav",
    format: "wav",
    file: `${"c".repeat(64)}.wav`,
    durationSeconds: 60,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  const region = addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 0,
    endSeconds: 10,
    label: "hum",
    note: "",
  });
  const analysis = putRegionFeatures(store, {
    regionId: region.id,
    target: TARGET,
    producer: PRODUCER,
    windows: [],
  });
  putRegionEmbedding(store, analysis.id, {
    embeddingProducer: "another-clap",
    embedding: new Uint8Array(Float32Array.from([0, 1]).buffer),
  });
  const attached = addAttachment(store, {
    vibeId: vibe.id,
    kind: ATTACHMENT_KIND.reference,
    regionId: region.id,
    details: {},
  });

  const read = await readSteering(store, vibe.id, embedder);
  expect(read.directions[0]).toMatchObject({
    scale: null,
    reason: expect.stringContaining("at least 2 excerpts"),
  });
  expect(steeringView(read).directions[0]?.positions).toEqual({});
  expect(read.regions[0]).toMatchObject({ id: attached.id, label: "hum", vector: null });
  expect(read.regions[0]?.reason).toContain("press Measure");
  expect(chosenSteering(read, { directions: [{ id: typed.id, setting: 1 }], regions: [] })).toMatch(
    /^The direction from “dry” to “underwater” can't be steered by yet: a scale needs at least 2/,
  );
  expect(chosenSteering(read, { directions: [], regions: [attached.id] })).toMatch(
    /^The region “hum” can't be steered toward yet/,
  );

  const none = await readSteering(store, empty.id, embedder);
  expect(none.directions[0]).toMatchObject({
    vector: null,
    reason: "it starts from this brief's excerpts, and none has its sound analyzed yet",
  });
});

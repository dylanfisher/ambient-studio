// The regions attached to a vibe as its prompt reads them (decision 0052): measurements from the
// region's analysis at the brief's loudness, and the words nearest its sound by a scripted
// embedder. No test reaches the sidecar.
/** @import { Store } from "../../src/server/store.js" */
import { afterEach, expect, test } from "vitest";
import { ATTACHMENT_KIND } from "../../src/domain/attachment-kind.js";
import { REFERENCE_WORDS } from "../../src/domain/reference-words.js";
import { addAttachment } from "../../src/server/attachment-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { promptReferences } from "../../src/server/prompt-references.js";
import { addReferenceFile, addRegion } from "../../src/server/reference-store.js";
import { putRegionEmbedding, putRegionFeatures } from "../../src/server/region-analysis-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const CLAP = "clap-test";
const FEATURES = {
  raw: { loudness: -30, shortTermMax: -25, loudnessRange: 3, truePeak: -6 },
  heard: {
    gainDb: 14,
    centroidMean: 400,
    centroidSpread: 60,
    onsetRate: 0.1,
    lowEndShare: 0.6,
    stereoWidth: 0.05,
    flatness: 0.02,
  },
};
const WINDOWS = [{ startSeconds: 0, seconds: 10, features: FEATURES, notHeard: null }];

/**
 * A vibe at -14 LUFS with one region attached and analyzed at that target, its embedding
 * pointing along [1, 0].
 * @param {Store} store
 * @param {{ target?: number, embeddingProducer?: string | null }} [options]
 */
function attachedVibe(store, { target = -14, embeddingProducer = CLAP } = {}) {
  const vibe = createVibe(store, {
    name: "dawn",
    brief: "a low hum",
    constraints: { loudness: -14 },
    softTargets: {},
  });
  const { reference } = addReferenceFile(store, {
    sha256: "e".repeat(64),
    fileName: "dawn.wav",
    format: "wav",
    file: `${"e".repeat(64)}.wav`,
    durationSeconds: 60,
    channels: 2,
    sampleRate: 48000,
    sizeBytes: 10,
  });
  const region = addRegion(store, {
    referenceFileId: reference.id,
    startSeconds: 0,
    endSeconds: 10,
    label: "dawn hum",
    note: "under the birds",
  });
  const analysis = putRegionFeatures(store, {
    regionId: region.id,
    target,
    producer: PRODUCER,
    windows: WINDOWS,
  });
  if (embeddingProducer !== null) {
    const embedding = new Uint8Array(new Float32Array([1, 0]).buffer);
    putRegionEmbedding(store, analysis.id, { embeddingProducer, embedding });
  }
  const attachment = addAttachment(store, {
    vibeId: vibe.id,
    kind: ATTACHMENT_KIND.reference,
    regionId: region.id,
    details: {},
  });
  return { vibe, region, attachment };
}

/**
 * A scripted embedder: word i of the vocabulary sits at angle (i + 1) / 40 radians from [1, 0], so the
 * vocabulary's first words are nearest, except "slow", which is put straight on the sound.
 */
function scriptedEmbedder() {
  /** @type {string[]} */
  const asked = [];
  return {
    asked,
    embedder: {
      producer: CLAP,
      embedText: async (/** @type {string} */ text) => {
        asked.push(text);
        const angle = text === "slow" ? 0 : (REFERENCE_WORDS.indexOf(text) + 1) / 40;
        return new Float32Array([Math.cos(angle), Math.sin(angle)]);
      },
    },
  };
}

test("reads the label, note and windows, and the five words nearest the sound in order", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { vibe, attachment } = attachedVibe(made.store);
  const { embedder, asked } = scriptedEmbedder();
  const references = await promptReferences(made.store, vibe.id, embedder);
  expect(references).toEqual([
    {
      id: attachment.id,
      label: "dawn hum",
      note: "under the birds",
      windows: [FEATURES],
      words: ["slow", ...REFERENCE_WORDS.slice(0, 4)],
    },
  ]);
  expect(asked).toEqual([...REFERENCE_WORDS]);
});

test("with no embedder the region has no words; a sound embedded under another checkpoint, or none, stops generation", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { vibe, region } = attachedVibe(made.store, { embeddingProducer: "an older clap" });
  const { embedder, asked } = scriptedEmbedder();
  expect((await promptReferences(made.store, vibe.id, null))[0]?.words).toEqual([]);
  await expect(promptReferences(made.store, vibe.id, embedder)).rejects.toThrow(
    `region ${region.id} ("dawn hum"), attached to this brief, has its sound analyzed under an older clap, not the sidecar's ${CLAP}; press Measure on the brief page, or detach it`,
  );
  const other = await tempStore();
  cleanups.push(other.remove);
  const unembedded = attachedVibe(other.store, { embeddingProducer: null });
  await expect(promptReferences(other.store, unembedded.vibe.id, embedder)).rejects.toThrow(
    "has its sound analyzed under no checkpoint",
  );
  expect(asked).toEqual([]);
});

test("a region with no analysis at the brief's loudness stops generation, naming it", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { vibe, region } = attachedVibe(made.store, { target: -16 });
  await expect(promptReferences(made.store, vibe.id, null)).rejects.toThrow(
    `region ${region.id} ("dawn hum"), attached to this brief, isn't analyzed at its loudness, -14 LUFS; press Measure on the brief page, or detach it`,
  );
});

test("a vibe with nothing attached reads no references and embeds nothing", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const vibe = createVibe(made.store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const { embedder, asked } = scriptedEmbedder();
  expect(await promptReferences(made.store, vibe.id, embedder)).toEqual([]);
  expect(asked).toEqual([]);
});

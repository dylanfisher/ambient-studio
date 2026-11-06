// Generations, genomes and candidates (decision 0021).
import { afterEach, expect, test } from "vitest";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import {
  addCandidate,
  getCandidate,
  getGeneration,
  getGenome,
  putGenome,
} from "../../src/server/generation-store.js";
import { genomeHash } from "../../src/server/genome-hash.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { fillStore, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function made() {
  const made = await tempStore();
  cleanups.push(made.remove);
  return made;
}

const vibeDraft = { name: "v", brief: "b", constraints: {}, softTargets: {} };

/**
 * @param {number} vibeRevisionId
 * @param {number | null} genomeId
 */
const candidate = (vibeRevisionId, genomeId) => ({
  vibeRevisionId,
  generationId: null,
  genomeId,
  seed: 5,
  source: "mutation",
  parentIds: [1],
  locks: ["tuning"],
  operator: "jitter",
  operatorParams: { amount: 0.1 },
  intent: null,
  rejectReason: null,
  lint: { ok: true, findings: [] },
});

test("two candidates reaching one genome share its row", async () => {
  const { store } = await made();
  const vibe = createVibe(store, vibeDraft);
  const first = putGenome(store, vibe.id, droneGenome);
  // The same genome with its keys in another order.
  const reordered = Object.fromEntries(Object.entries(droneGenome).reverse());
  const second = putGenome(store, vibe.id, reordered);
  expect(second).toEqual(first);
  const a = addCandidate(store, candidate(vibe.revision.id, first.id));
  const b = addCandidate(store, candidate(vibe.revision.id, second.id));
  expect(a.id).not.toBe(b.id);
  expect(a.genomeId).toBe(b.genomeId);
  expect(store.db.prepare("SELECT count(*) AS n FROM genomes").get()?.n).toBe(1);
  expect(first.genomeHash).toBe(genomeHash(droneGenome));
  expect(first.genome).toEqual(JSON.parse(canonicalGenome(droneGenome)));
});

test("the same genome in another vibe gets its own row", async () => {
  const { store } = await made();
  const one = createVibe(store, vibeDraft);
  const two = createVibe(store, vibeDraft);
  const ids = [one, two].map((vibe) => putGenome(store, vibe.id, droneGenome).id);
  expect(ids[0]).not.toBe(ids[1]);
});

test("an invalid genome is refused", async () => {
  const { store } = await made();
  const vibe = createVibe(store, vibeDraft);
  expect(() => putGenome(store, vibe.id, { voices: "none" })).toThrow(/invalid genome/);
});

test("a rejected candidate is stored with no genome, and rows read back after a reopen", async () => {
  const { store, reopen } = await made();
  const ids = fillStore(store);
  const generationId = ids.generations;
  const genomeId = ids.genomes;
  const generation = getGeneration(store, generationId);
  const rejected = addCandidate(store, {
    ...candidate(ids.vibe_revisions, null),
    rejectReason: "truncated",
    lint: null,
  });
  const reopened = reopen();
  expect(getCandidate(reopened, rejected.id)).toEqual(rejected);
  expect(getGeneration(reopened, generationId)).toEqual(generation);
  expect(generation?.prompt).toEqual([{ role: "user", content: "a drone" }]);
  expect(getGenome(reopened, genomeId)?.genomeHash).toBe(genomeHash(droneGenome));
});

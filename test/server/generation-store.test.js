// Generations, genomes and candidates (decision 0021).
import { afterEach, expect, test } from "vitest";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import {
  addCandidate,
  addGeneration,
  getCandidate,
  getGeneration,
  getGenome,
  listGenomes,
  listRequestGroup,
  putGenome,
} from "../../src/server/generation-store.js";
import { genomeHash } from "../../src/server/genome-hash.js";
import { openStore, readMigrations } from "../../src/server/store.js";
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
  rejectedGenome: null,
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

test("listRequestGroup lists one group's generations, oldest first", async () => {
  const { store } = await made();
  const ids = fillStore(store);
  const first = getGeneration(store, ids.generations);
  if (!first) throw new Error("fillStore wrote no generation");
  const { id, createdAt, removedAt, removedReason, ...draft } = first;
  const second = addGeneration(store, { ...draft, repairRound: 1, repairsId: first.id });
  addGeneration(store, { ...draft, requestGroup: "another" });
  expect(listRequestGroup(store, first.requestGroup)).toEqual([first, second]);
  expect(listRequestGroup(store, "none")).toEqual([]);
});

test("listGenomes lists the genomes a vibe has reached, oldest first", async () => {
  const { store } = await made();
  const one = createVibe(store, vibeDraft);
  const two = createVibe(store, vibeDraft);
  const drone = putGenome(store, one.id, droneGenome);
  const quieter = { ...droneGenome, voices: [{ ...droneGenome.voices[0], level: -20 }] };
  const second = putGenome(store, one.id, quieter);
  putGenome(store, two.id, droneGenome);
  expect(listGenomes(store, one.id)).toEqual([drone, second]);
});

test("migration 0002 over a database built with 0001 keeps its rows and adds the new columns", async () => {
  const { paths, now } = await made();
  const file = `${paths.database}-0001`;
  const [first] = readMigrations();
  if (!first) throw new Error("no migrations");
  const old = openStore(file, { now, migrations: [first] });
  // Rows in 0001's shape, written by hand since the store's functions write 0002's.
  const run = (/** @type {string} */ sql) => old.db.prepare(sql).run();
  run("INSERT INTO vibes (id, createdAt) VALUES (1, 0)");
  run(
    `INSERT INTO vibe_revisions (id, vibeId, name, brief, constraints, softTargets, createdAt)
     VALUES (1, 1, 'v', 'b', '{}', '{}', 0)`,
  );
  run(
    `INSERT INTO generations (id, vibeRevisionId, requestGroup, prompt, exampleIds,
       retrievalMethod, model, sampling, response, finishReason, repairRound, latencyMs, createdAt)
     VALUES (1, 1, 'g', '[]', '[]', 'rating-recency', 'm', '{}', 'text', 'stop', 0, 5, 0)`,
  );
  run(
    `INSERT INTO candidates (id, vibeRevisionId, generationId, seed, source, parentIds, locks,
       rejectReason, createdAt)
     VALUES (1, 1, 1, 3, 'llm', '[]', '[]', 'noJson', 0)`,
  );
  old.close();

  const store = openStore(file, { now });
  cleanups.push(async () => store.close());
  expect(getGeneration(store, 1)).toMatchObject({
    response: "text",
    finishReason: "stop",
    reasoning: null,
    requestParams: null,
    retries: null,
    error: null,
  });
  expect(getCandidate(store, 1)).toMatchObject({ rejectReason: "noJson", rejectedGenome: null });
  // An error is stored only with the "error" finish reason.
  const errorSql = (/** @type {string} */ finishReason) =>
    `INSERT INTO generations (vibeRevisionId, requestGroup, prompt, exampleIds, retrievalMethod,
       model, sampling, response, finishReason, repairRound, latencyMs, error, createdAt)
     VALUES (1, 'g', '[]', '[]', 'r', 'm', '{}', '', '${finishReason}', 0, 1, 'timed out', 0)`;
  expect(() => store.db.prepare(errorSql("stop")).run()).toThrow(/CHECK constraint/);
  expect(() => store.db.prepare(errorSql("error")).run()).not.toThrow();
});

test("a generation's reasoning, request and error, and a candidate's rejected genome, read back", async () => {
  const { store, reopen } = await made();
  const ids = fillStore(store);
  const generation = getGeneration(store, ids.generations);
  if (!generation) throw new Error("fillStore wrote no generation");
  const { id, createdAt, removedAt, removedReason, ...draft } = generation;
  const failed = addGeneration(store, {
    ...draft,
    response: "",
    finishReason: "error",
    reasoning: null,
    error: "omlx request timed out after 600 s",
    retries: [{ attempt: 1, reason: "HTTP 429", delayMs: 2500 }],
  });
  const rejected = addCandidate(store, {
    ...candidate(ids.vibe_revisions, null),
    generationId: failed.id,
    rejectReason: "lintErrors",
    rejectedGenome: { voices: [] },
  });
  const reopened = reopen();
  expect(getGeneration(reopened, failed.id)).toEqual(failed);
  expect(getGeneration(reopened, ids.generations)).toEqual(generation);
  expect(generation.reasoning).toBe("thinking about a drone");
  expect(getCandidate(reopened, rejected.id)?.rejectedGenome).toEqual({ voices: [] });
});

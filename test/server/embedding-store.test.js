// The derived embeddings (decision 0042): found only under the caller's producer, one row per
// source, and a render's row gone with its render.
import { afterEach, expect, test } from "vitest";
import {
  dropOtherEmbeddings,
  findEmbedding,
  putEmbedding,
} from "../../src/server/embedding-store.js";
import { putRender } from "../../src/server/render-store.js";
import { fillStore, tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const VECTOR = new Uint8Array(new Float32Array([0.6, 0.8]).buffer);

async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const filled = fillStore(made.store);
  const draft = {
    genomeId: filled.genomes,
    seed: 3,
    offset: 10,
    duration: 25,
    target: -16,
    producer: "engine2-abc",
    file: "r1.mp3",
    features: {},
    checks: {},
  };
  const { render } = putRender(made.store, draft);
  return { store: made.store, ratedAudioId: filled.rated_audio, draft, render };
}

test("an embedding is found under its producer only, with its bytes", async () => {
  const { store, ratedAudioId } = await setup();
  const source = { ratedAudioId, renderId: null };
  putEmbedding(store, { ...source, producer: "clap-a", vector: VECTOR });
  expect(findEmbedding(store, source, "clap-a")?.vector).toEqual(VECTOR);
  expect(findEmbedding(store, source, "clap-b")).toBeUndefined();
});

test("a second put for a source replaces its row, and other producers' rows drop", async () => {
  const { store, ratedAudioId, render } = await setup();
  const audio = { ratedAudioId, renderId: null };
  const rendered = { ratedAudioId: null, renderId: render.id };
  putEmbedding(store, { ...audio, producer: "clap-a", vector: VECTOR });
  putEmbedding(store, { ...audio, producer: "clap-b", vector: VECTOR });
  putEmbedding(store, { ...rendered, producer: "clap-a", vector: VECTOR });
  expect(findEmbedding(store, audio, "clap-b")).toBeDefined();
  expect(dropOtherEmbeddings(store, "clap-b")).toBe(1);
  expect(findEmbedding(store, rendered, "clap-a")).toBeUndefined();
  expect(findEmbedding(store, audio, "clap-b")).toBeDefined();
});

test("a render's embedding goes when the render is replaced", async () => {
  const { store, draft, render } = await setup();
  const source = { ratedAudioId: null, renderId: render.id };
  putEmbedding(store, { ...source, producer: "clap-a", vector: VECTOR });
  putRender(store, { ...draft, producer: "engine3-def" });
  expect(findEmbedding(store, source, "clap-a")).toBeUndefined();
});

test("a row names exactly one source", async () => {
  const { store, ratedAudioId, render } = await setup();
  const both = /** @type {any} */ ({ ratedAudioId, renderId: render.id });
  expect(() => putEmbedding(store, { ...both, producer: "clap-a", vector: VECTOR })).toThrow(
    /CHECK constraint failed/,
  );
});

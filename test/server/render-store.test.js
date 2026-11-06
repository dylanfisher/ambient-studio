// The derived render cache, keyed with an opaque producer (decision 0021).
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putGenome } from "../../src/server/generation-store.js";
import { findRender, getRender, putRender } from "../../src/server/render-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const genome = putGenome(store, vibe.id, droneGenome);
  const key = {
    genomeId: genome.id,
    seed: 3,
    offset: 10,
    duration: 25,
    target: -16,
    producer: "engine2-abc",
  };
  const draft = { ...key, file: "r1.wav", features: { raw: {}, heard: {} }, checks: { ok: true } };
  return { ...made, key, draft };
}

test("a render is found by its full key, after a reopen too", async () => {
  const { store, reopen, key, draft } = await setup();
  const { render, replaced } = putRender(store, draft);
  expect(replaced).toBeUndefined();
  expect(render).toMatchObject(draft);
  expect(findRender(store, key)).toEqual(render);
  expect(findRender(reopen(), key)).toEqual(render);
});

test("a row with another producer or target isn't returned, and is replaced", async () => {
  const { store, key, draft } = await setup();
  const { render: old } = putRender(store, draft);
  expect(findRender(store, { ...key, producer: "engine2-def" })).toBeUndefined();
  expect(findRender(store, { ...key, target: -14 })).toBeUndefined();

  const newer = { ...draft, producer: "engine2-def", file: "r2.wav" };
  const { render, replaced } = putRender(store, newer);
  expect(replaced).toEqual(old);
  expect(findRender(store, key)).toBeUndefined();
  expect(findRender(store, { ...key, producer: "engine2-def" })).toEqual(render);

  const retargeted = putRender(store, { ...newer, target: -14, file: "r3.wav" });
  expect(retargeted.replaced).toEqual(render);
  expect(store.db.prepare("SELECT count(*) AS n FROM renders").get()?.n).toBe(1);
});

test("another window of the same genome is a separate row", async () => {
  const { store, key, draft } = await setup();
  putRender(store, draft);
  putRender(store, { ...draft, offset: 40, file: "r2.wav" });
  expect(findRender(store, key)?.file).toBe("r1.wav");
  expect(findRender(store, { ...key, offset: 40 })?.file).toBe("r2.wav");
});

test("a render is read by its id, and an unknown id reads as undefined", async () => {
  const { store, draft } = await setup();
  const { render } = putRender(store, draft);
  expect(getRender(store, render.id)).toEqual(render);
  expect(getRender(store, render.id + 1)).toBeUndefined();
});

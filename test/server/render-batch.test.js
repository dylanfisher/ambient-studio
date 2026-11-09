// A batch of independent renders, a few at a time (decision 0076): results in the items' order,
// never more than the limit in flight, and a cancel or a failure waits for what is in flight.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { putGenome } from "../../src/server/generation-store.js";
import { RENDER_CONCURRENCY, renderBatch } from "../../src/server/render-batch.js";
import { renderExcerpt } from "../../src/server/render-excerpt.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A fake render per item that finishes only when the test says, recording what is in flight. */
function heldWork() {
  /** @type {Map<number, { resolve: (value: string) => void, reject: (error: Error) => void }>} */
  const held = new Map();
  /** @type {number[]} */
  const started = [];
  let inFlight = 0;
  let maxInFlight = 0;
  /** @type {(() => void)[]} */
  const waiters = [];
  /** @param {string} item @param {number} index */
  const work = (item, index) =>
    new Promise((resolve, reject) => {
      started.push(index);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      /** @param {() => void} settle */
      const leave = (settle) => {
        inFlight -= 1;
        settle();
      };
      held.set(index, {
        resolve: () => leave(() => resolve(`${item} rendered`)),
        reject: (error) => leave(() => reject(error)),
      });
      for (const wake of waiters.splice(0)) wake();
    });
  /** Waits until `count` items have started, without waiting on time. */
  const startedAtLeast = async (/** @type {number} */ count) => {
    while (started.length < count) await new Promise((wake) => waiters.push(() => wake(null)));
  };
  /** @param {number} index */
  const item = (index) => {
    const found = held.get(index);
    if (!found) throw new Error(`item ${index} hasn't started`);
    return found;
  };
  return { work, started, startedAtLeast, item, maxInFlight: () => maxInFlight };
}

describe("renderBatch", () => {
  test("runs up to the limit at once and returns results in the items' order", async () => {
    const items = ["a", "b", "c", "d", "e"];
    const fake = heldWork();
    /** @type {number[]} */
    const reports = [];
    const batch = renderBatch(items, fake.work, {
      signal: new AbortController().signal,
      limit: 2,
      progress: (done) => reports.push(done),
    });
    await fake.startedAtLeast(2);
    expect(fake.started).toEqual([0, 1]);
    // Finishing out of order still fills each result at its item's place.
    fake.item(1).resolve("");
    await fake.startedAtLeast(3);
    fake.item(2).resolve("");
    await fake.startedAtLeast(4);
    fake.item(0).resolve("");
    await fake.startedAtLeast(5);
    fake.item(4).resolve("");
    fake.item(3).resolve("");
    expect(await batch).toEqual(items.map((each) => `${each} rendered`));
    expect(fake.maxInFlight()).toBe(2);
    expect(reports).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("runs more than one render at once by default", async () => {
    expect(RENDER_CONCURRENCY).toBeGreaterThan(1);
    expect(RENDER_CONCURRENCY).toBeLessThanOrEqual(4);
    const fake = heldWork();
    const items = Array.from({ length: 2 * RENDER_CONCURRENCY }, (_, i) => String(i));
    const batch = renderBatch(items, fake.work, { signal: new AbortController().signal });
    await fake.startedAtLeast(RENDER_CONCURRENCY);
    expect(fake.started).toHaveLength(RENDER_CONCURRENCY);
    for (let i = 0; i < items.length; i++) {
      await fake.startedAtLeast(Math.min(i + RENDER_CONCURRENCY, items.length));
      fake.item(i).resolve("");
    }
    await batch;
    expect(fake.maxInFlight()).toBe(RENDER_CONCURRENCY);
  });

  test("a failure starts nothing more, waits for the items in flight, then throws it", async () => {
    const fake = heldWork();
    let settled = false;
    const batch = renderBatch(["a", "b", "c", "d"], fake.work, {
      signal: new AbortController().signal,
      limit: 2,
    }).finally(() => {
      settled = true;
    });
    batch.catch(() => {});
    await fake.startedAtLeast(2);
    fake.item(0).reject(new Error("render a failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    fake.item(1).resolve("");
    await expect(batch).rejects.toThrow("render a failed");
    expect(fake.started).toEqual([0, 1]);
  });

  test("several failures throw one error naming each", async () => {
    const fake = heldWork();
    const batch = renderBatch(["a", "b", "c"], fake.work, {
      signal: new AbortController().signal,
      limit: 2,
    });
    batch.catch(() => {});
    await fake.startedAtLeast(2);
    fake.item(1).reject(new Error("render b failed"));
    fake.item(0).reject(new Error("render a failed"));
    await expect(batch).rejects.toThrow(
      "2 renders of a batch failed: render b failed; render a failed",
    );
    expect(fake.started).toEqual([0, 1]);
  });

  test("a cancel starts nothing more and throws the signal's reason once those in flight end", async () => {
    const fake = heldWork();
    const controller = new AbortController();
    const batch = renderBatch(["a", "b", "c", "d"], fake.work, {
      signal: controller.signal,
      limit: 2,
    });
    batch.catch(() => {});
    await fake.startedAtLeast(2);
    controller.abort(new Error("cancelled"));
    fake.item(0).resolve("");
    fake.item(1).resolve("");
    await expect(batch).rejects.toThrow("cancelled");
    expect(fake.started).toEqual([0, 1]);
  });

  test("a limit below 1 is refused", async () => {
    const signal = new AbortController().signal;
    await expect(renderBatch([], async () => 0, { signal, limit: 0 })).rejects.toThrow(
      "at least 1 item at once, not 0",
    );
  });
});

describe("renderBatch over real excerpts", () => {
  /** A store holding the drone golden, and three short windows of it at different seeds. */
  async function setup() {
    const made = await tempStore();
    cleanups.push(made.remove);
    const { store } = made;
    const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
    const { id } = putGenome(store, vibe.id, droneGenome);
    return {
      store,
      cache: made.paths.renderCache,
      requests: [3, 5, 7].map((seed) => ({ genomeId: id, seed, target: -16 })),
    };
  }

  /**
   * Each window rendered through a batch at `limit`, as its key and its MP3's hash.
   * @param {number} limit
   */
  async function rendered(limit) {
    const { store, cache, requests } = await setup();
    const excerpts = await renderBatch(
      requests,
      (request) => renderExcerpt(store, cache, request, undefined, { offset: 10, duration: 2 }),
      { signal: new AbortController().signal, limit },
    );
    return Promise.all(
      excerpts.map(async ({ render }) => ({
        seed: render.seed,
        file: render.file,
        features: render.features,
        sha256: sha256Hex(await readFile(join(cache, render.file))),
      })),
    );
  }

  test("renders the same audio in the same order as one at a time", async () => {
    const serial = await rendered(1);
    const parallel = await rendered(3);
    expect(parallel.map(({ seed }) => seed)).toEqual([3, 5, 7]);
    expect(parallel).toEqual(serial);
  });
});

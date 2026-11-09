// A track's recipe and the key its render is cached by (decision 0062): the owner's text on
// sections and transitions (0077) is left out of both, so writing it, or migrating a revision
// that had none, never makes a new render.
/** @import { Arrangement } from "../../src/domain/arrangement-schema.js" */
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { addSketch } from "../../src/server/rating-store.js";
import { recipeKey, trackRecipe } from "../../src/server/track-manifest.js";
import { createTrack, reviseTrack } from "../../src/server/track-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/**
 * A store with a vibe and two drone sketches in keys 2 and 5.
 * @returns {Promise<{ store: import("../../src/server/store.js").Store, vibe: ReturnType<typeof createVibe>, first: number, second: number }>}
 */
async function twoSketches() {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, {
    name: "dawn",
    brief: "a hum",
    constraints: {},
    softTargets: {},
  });
  const sketches = [2, 5].map((key, i) =>
    addSketch(store, {
      candidateId: addCandidate(store, {
        vibeRevisionId: vibe.revision.id,
        generationId: null,
        sessionId: null,
        genomeId: putGenome(store, vibe.id, { ...droneGenome, key }).id,
        seed: 11 + i,
        source: "llm",
        parentIds: [],
        locks: [],
        operator: null,
        operatorParams: null,
        intent: null,
        rejectReason: null,
        lint: null,
        rejectedGenome: null,
      }).id,
      notes: "",
      tags: [],
    }),
  );
  const [first, second] = /** @type {[number, number]} */ (sketches.map(({ id }) => id));
  return { store, vibe, first, second };
}

test("text on sections and transitions changes neither the recipe nor its key", async () => {
  const { store, vibe, first, second } = await twoSketches();
  // A morph between two windows of one sketch, which morphs, and a crossfade into another.
  const before = {
    ...emptyArrangement(),
    sections: [
      { sketchId: first, offset: 0, seconds: 20 },
      { sketchId: first, offset: 30, seconds: 20 },
      { sketchId: second, offset: 0, seconds: 20 },
    ],
    transitions: [
      { kind: "morph", seconds: 8, curve: "smooth" },
      { kind: "crossfade", seconds: 4 },
    ],
  };
  /** @param {(part: object) => string} text */
  const written = (text) => ({
    ...before,
    sections: before.sections.map((section) => ({ ...section, text: text(section) })),
    transitions: before.transitions.map((transition) => ({
      ...transition,
      text: text(transition),
    })),
  });
  const { track, revision: old } = createTrack(store, {
    vibeId: vibe.id,
    name: "t",
    // 0011's shape, as a revision stored before migration 0012.
    arrangement: /** @type {Arrangement} */ (/** @type {unknown} */ (before)),
  });
  const empty = reviseTrack(store, track.id, { arrangement: written(() => ""), note: "" });
  const words = reviseTrack(store, track.id, {
    arrangement: written((part) => `slowly, ${JSON.stringify(part).length} characters in`),
    note: "",
  });
  const recipes = [old, empty, words].map(
    (revision) => trackRecipe(store, { track, revision, constraints: {} }).recipe,
  );
  expect(recipes[0]?.transitions[0]).toMatchObject({ kind: "morph", morphSeconds: 8 });
  const keys = recipes.map(recipeKey);
  expect(new Set(keys).size).toBe(1);
  // The recipe differs only in the revision it came from.
  const withoutTrack = recipes.map(({ track: _, ...rest }) => rest);
  expect(withoutTrack[1]).toEqual(withoutTrack[0]);
  expect(withoutTrack[2]).toEqual(withoutTrack[0]);
});

/**
 * Three sections, the first two windows of one sketch, joined by `kind` and then a crossfade.
 * @param {number} first
 * @param {number} second
 * @param {string} kind
 * @returns {Arrangement}
 */
const threeSections = (first, second, kind) => ({
  ...emptyArrangement(),
  sections: [
    { sketchId: first, offset: 0, seconds: 20, text: "" },
    { sketchId: first, offset: 30, seconds: 20, text: "" },
    { sketchId: second, offset: 0, seconds: 20, text: "" },
  ],
  transitions: [
    kind === "crossfade"
      ? { kind, seconds: 8, text: "" }
      : { kind, seconds: 8, curve: "smooth", text: "" },
    { kind: "crossfade", seconds: 4, text: "" },
  ],
});

test("the recipe names a weave, which with no voice to split renders the morph's sections", async () => {
  const { store, vibe, first, second } = await twoSketches();
  const { track, revision: morphed } = createTrack(store, {
    vibeId: vibe.id,
    name: "t",
    arrangement: threeSections(first, second, "morph"),
  });
  const woven = reviseTrack(store, track.id, {
    arrangement: threeSections(first, second, "weave"),
    note: "",
  });
  const [morph, weave] = [morphed, woven].map(
    (revision) => trackRecipe(store, { track, revision, constraints: {} }).recipe,
  );
  expect(weave?.transitions).toEqual([
    { kind: "weave", seconds: 4, morphSeconds: 8, curve: "smooth" },
    { kind: "crossfade", seconds: 4 },
  ]);
  expect(weave?.sections).toEqual(morph?.sections);
});

test("a crossfade-only or morph track keeps the recipe key it had before weaves", async () => {
  const { store, vibe, first, second } = await twoSketches();
  const keys = ["crossfade", "morph"].map((kind) => {
    const { track, revision } = createTrack(store, {
      vibeId: vibe.id,
      name: kind,
      arrangement: threeSections(first, second, kind),
    });
    const { recipe } = trackRecipe(store, { track, revision, constraints: {} });
    // Fixed versions, so the key reads only what this repo decides.
    return recipeKey({ ...recipe, node: "26.12.1", nodeWebAudioApi: "1.0.0" });
  });
  // Both keys as computed at 07a0460, before the weave.
  expect(keys).toEqual([
    "10493d6a6a756d67f0d7d57ec637408622783d2e859b4e48fe284f3ed1fb86fc",
    "9cc6d01dbe1730fe427ceb2cf2b6be9bafdb7124e556aedb5d33bbf58c1e3e13",
  ]);
});

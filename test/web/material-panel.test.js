// The timeline's material panel (decision 0066), with no DOM: each sketch's position on the
// brief's directions is 5g's projection on the vibe's scale, read from the steering route's view
// of hand-made embeddings; the map's elites are listed by cell with the cell's axis words; and a
// brief with no map, directions or regions lists its sketches alone.
import { expect, test } from "vitest";
import { directionVector, projection } from "../../src/domain/direction-vector.js";
import { scaledPosition, vibeScale } from "../../src/domain/vibe-scale.js";
import { steeringView } from "../../src/server/vibe-steering.js";
import { cellWords, materialPanel } from "../../src/web/material-panel.js";

/** Three excerpts' embeddings, by render id. */
const EXCERPTS = [
  { renderId: 11, vector: Float32Array.from([1, 0, 0]) },
  { renderId: 12, vector: Float32Array.from([0.6, 0.8, 0]) },
  { renderId: 13, vector: Float32Array.from([0, 0.6, 0.8]) },
];

const SKETCHES = [
  { id: 1, candidateId: 21, intent: "cold", duration: 300, excerpt: { renderId: 11 } },
  { id: 2, candidateId: 22, intent: null, duration: 240, excerpt: { renderId: 13 } },
  { id: 3, candidateId: 23, intent: "unheard", duration: 200, excerpt: null },
];

/** A steering view as the route gives it, from one direction over the three excerpts. */
function steering() {
  const vector = directionVector([1, 0, 0], [0, 0.6, 0.8]);
  const scale = vibeScale(EXCERPTS.map((excerpt) => projection(excerpt.vector, vector)));
  // The route sends the view as JSON, so its render ids arrive as keys.
  const view = JSON.parse(
    JSON.stringify(
      steeringView({
        excerpts: EXCERPTS,
        directions: [{ id: 5, near: "dry", far: "underwater", vector, scale, reason: null }],
        regions: [],
      }),
    ),
  );
  return { view: { reason: null, ...view }, vector, scale };
}

const NO_MAP = { reason: "Choose two or three axes.", model: false, axes: [], cells: [] };

test("each sketch's position is its excerpt's projection on the vibe's scale, as 5g reads it", () => {
  const { view, vector, scale } = steering();
  const panel = materialPanel({ sketches: SKETCHES, archive: NO_MAP, steering: view, regions: [] });
  const expected = (/** @type {number} */ i) =>
    scaledPosition(
      projection(/** @type {Float32Array} */ (EXCERPTS[i]?.vector), vector),
      /** @type {NonNullable<typeof scale>} */ (scale),
    );
  expect(panel.sketches.map((row) => row.positions)).toEqual([
    [{ directionId: 5, position: expected(0) }],
    [{ directionId: 5, position: expected(2) }],
    [{ directionId: 5, position: null }],
  ]);
  expect(panel.sketches[0]?.line).toBe(
    `Where it sits, from 0 (this brief's least) to 1 (its most): “dry” to “underwater” ${expected(0).toFixed(2)}.`,
  );
  expect(panel.directions).toEqual([
    { id: 5, text: "“dry” to “underwater”", near: "dry", far: "underwater", reason: null },
  ]);
});

const AXES = [
  { source: "feature", name: "centroidMean", low: 200, high: 1000, bins: 8, reason: null },
  { source: "macro", name: "motion", low: 0, high: 1, bins: 8, reason: null },
];

/** @param {number[]} index @param {number} candidateId */
const cell = (index, candidateId) => ({
  index,
  count: 1,
  candidateId,
  renderId: 100 + candidateId,
  url: `/audio/${100 + candidateId}`,
  intent: "seeded",
  ownIntent: true,
  score: null,
  misses: 0,
});

test("the map's elites are listed by cell with the cell's axis words, and one already kept names its sketch", () => {
  const archive = {
    reason: null,
    model: false,
    axes: AXES,
    cells: [cell([0, 7], 21), cell([3, 4], 40)],
  };
  const panel = materialPanel({ sketches: SKETCHES, archive, steering: null, regions: [] });
  expect(panel.elitesLine).toBe("2 filled cells of the map, each with its best candidate.");
  expect(panel.elites.map(({ key, sketchId, words }) => ({ key, sketchId, words }))).toEqual([
    {
      key: "0,7",
      sketchId: 1,
      words: "spectral centroid (Hz) up to 300; motion (the macro, over the excerpt) 0.875 or more",
    },
    {
      key: "3,4",
      sketchId: null,
      words: "spectral centroid (Hz) 500 to 600; motion (the macro, over the excerpt) 0.5 to 0.625",
    },
  ]);
  expect(panel.elites[0]?.label).toMatch(/^Candidate #21 \(kept as sketch 1\): spectral centroid/);
  expect(panel.elites[1]?.about).toBe(
    "The candidate here: “seeded”, missing 0 of the brief's ranges.",
  );
  expect(cellWords(AXES, [7, 0])).toBe(
    "spectral centroid (Hz) 900 or more; motion (the macro, over the excerpt) up to 0.125",
  );
});

test("with no map, directions or regions the panel lists the sketches alone", () => {
  const panel = materialPanel({
    sketches: SKETCHES,
    archive: NO_MAP,
    steering: { reason: null, directions: [], regions: [] },
    regions: [],
  });
  expect(panel.sketches.map(({ name, positions, line }) => ({ name, positions, line }))).toEqual([
    { name: "Sketch 1: cold, 5:00", positions: [], line: "" },
    { name: "Sketch 2, 4:00", positions: [], line: "" },
    { name: "Sketch 3: unheard, 3:20", positions: [], line: "" },
  ]);
  expect(panel.elites).toEqual([]);
  expect(panel.elitesLine).toBe("No elites from the map: Choose two or three axes.");
  expect(panel.directions).toEqual([]);
  expect(panel.regions).toEqual([]);
});

test("a steering that can't be read gives every direction its reason", () => {
  const { view } = steering();
  const off = { ...view, reason: "the sound analysis is off" };
  const panel = materialPanel({ sketches: [], archive: null, steering: off, regions: [] });
  expect(panel.directions.map(({ reason }) => reason)).toEqual(["the sound analysis is off"]);
  expect(panel.elitesLine).toBe("Reading the map…");
});

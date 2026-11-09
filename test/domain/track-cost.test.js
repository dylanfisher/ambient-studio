// A track's cost and render estimate (decision 0062): the most cost sounding at once, two
// sections in a crossfade, and the work its chunks take, pre-roll included.
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { sectionGenome } from "../../src/domain/section-genome.js";
import { BENCH_RATE, trackCost, trackSeconds } from "../../src/domain/track-cost.js";
import { CHUNK_SECONDS } from "../../src/engine/chunk-windows.js";
import { cost } from "../../src/engine/cost.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { MORPH_HANDOVER } from "../../src/engine/morph.js";
import { preRoll } from "../../src/engine/render-plan.js";

const genomes = new Map([
  [1, droneGenome],
  [
    2,
    {
      ...droneGenome,
      duration: 300,
      voices: [...droneGenome.voices, { ...droneGenome.voices[0], id: "b" }],
    },
  ],
]);

const arrangement = {
  ...emptyArrangement(),
  sections: [
    { sketchId: 1, offset: 0, seconds: 40, text: "" },
    { sketchId: 2, offset: 30, seconds: 250, text: "" },
  ],
  transitions: [{ kind: "crossfade", seconds: 10, text: "" }],
};

test("the peak is both sections' cost in a crossfade, and the work counts each chunk's pre-roll", () => {
  const one = cost(sectionGenome(arrangement, 0, genomes));
  const second = sectionGenome(arrangement, 1, genomes);
  const two = cost(second);
  const found = trackCost(arrangement, genomes);
  expect(found.peak).toBe(one + two);
  expect(found.audio).toBe(290);
  expect(found.length).toBe(280);
  // Section 2 is three chunks, from 30, 150 and 270 s on its sketch's timeline.
  const chunks = [30, 30 + CHUNK_SECONDS, 30 + 2 * CHUNK_SECONDS];
  const lengths = [CHUNK_SECONDS, CHUNK_SECONDS, 250 - 2 * CHUNK_SECONDS];
  const work =
    one * 40 +
    chunks.reduce((sum, at, i) => sum + two * ((lengths[i] ?? 0) + preRoll(second, at)), 0);
  expect(found.work).toBeCloseTo(work, 9);
});

test("a morph counts both sections, and the incoming one only from the handover", () => {
  const morphed = {
    ...arrangement,
    transitions: [{ kind: "morph", seconds: 12, curve: "smooth", text: "" }],
  };
  const morph = sectionGenome(morphed, 0, genomes);
  // The morph's genome holds the incoming sketch's second drone, rising.
  expect(morph.voices.map(({ id }) => id).sort()).toEqual(["b", "drone"]);
  const two = cost(sectionGenome(morphed, 1, genomes));
  const found = trackCost(morphed, genomes);
  expect(found.peak).toBe(cost(morph) + two);
  expect(found.audio).toBe(40 + 250 - (12 - MORPH_HANDOVER));
  expect(found.length).toBe(278);
});

test("a weave counts as a morph does, the incoming section from the handover", () => {
  const woven = {
    ...arrangement,
    transitions: [{ kind: "weave", seconds: 12, curve: "smooth", text: "" }],
  };
  const weave = sectionGenome(woven, 0, genomes);
  expect(weave.voices.map(({ id }) => id).sort()).toEqual(["b", "drone"]);
  const found = trackCost(woven, genomes);
  expect(found.peak).toBe(cost(weave) + cost(sectionGenome(woven, 1, genomes)));
  expect(found.audio).toBe(40 + 250 - (12 - MORPH_HANDOVER));
});

test("one section's peak is its own cost, and an empty track costs nothing", () => {
  const alone = {
    ...emptyArrangement(),
    sections: [{ sketchId: 1, offset: 0, seconds: 40, text: "" }],
  };
  expect(trackCost(alone, genomes).peak).toBe(cost(sectionGenome(alone, 0, genomes)));
  expect(trackCost(emptyArrangement(), genomes)).toEqual({ peak: 0, work: 0, audio: 0, length: 0 });
});

test("the estimate is the work at a rate of node-seconds a second", () => {
  expect(
    trackSeconds({ peak: 600, work: BENCH_RATE * 150, audio: 1210, length: 1200 }, BENCH_RATE),
  ).toBe(150);
});

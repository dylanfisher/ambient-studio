// A section's genome (decision 0062): the sketch's genome with no master fade inside the track,
// extended when the section runs past the sketch's end.
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { sectionGenome } from "../../src/domain/section-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

const drone = requireGenome(droneGenome, "drone");
/** A second voice that leaves before the sketch ends, and one that leaves at its end. */
const twoVoices = requireGenome(
  {
    ...droneGenome,
    voices: [
      { ...droneGenome.voices[0], id: "early", end: 40 },
      { ...droneGenome.voices[0], id: "last", end: 60 },
      { ...droneGenome.voices[0], id: "open" },
    ],
  },
  "two voices",
);

/** @param {{ sketchId: number, offset: number, seconds: number }[]} sections */
const arrangement = (sections) => ({
  ...emptyArrangement(),
  sections,
  transitions: sections.slice(1).map(() => ({ kind: "crossfade", seconds: 4 })),
});

test("a section inside its sketch plays the sketch's genome with no master fades", () => {
  const genomes = new Map([[1, droneGenome]]);
  const track = arrangement([
    { sketchId: 1, offset: 0, seconds: 30 },
    { sketchId: 1, offset: 10, seconds: 30 },
    { sketchId: 1, offset: 20, seconds: 40 },
  ]);
  for (const index of [0, 1, 2]) {
    expect(sectionGenome(track, index, genomes)).toEqual({ ...drone, fadeIn: 0, fadeOut: 0 });
  }
});

test("a section past its sketch's end extends the timeline and the voices that reach the end", () => {
  const genomes = new Map([[2, twoVoices]]);
  const genome = sectionGenome(arrangement([{ sketchId: 2, offset: 30, seconds: 90 }]), 0, genomes);
  expect(genome.duration).toBe(120);
  expect(genome.voices.map(({ id, end }) => [id, end])).toEqual([
    ["early", 40],
    ["last", 120],
    ["open", 900],
  ]);
  // The trajectories are kept as they are, holding past their last point (0007).
  expect(genome.voices[0]?.cutoff).toEqual(twoVoices.voices[0]?.cutoff);
  expect(requireGenome(genome, "extended")).toEqual(genome);
});

test("a section names a sketch the caller has no genome for", () => {
  expect(() =>
    sectionGenome(arrangement([{ sketchId: 9, offset: 0, seconds: 30 }]), 0, new Map()),
  ).toThrow("section 1 plays sketch 9, which has no genome here");
  expect(() => sectionGenome(arrangement([]), 0, new Map())).toThrow("there is no section 1");
});

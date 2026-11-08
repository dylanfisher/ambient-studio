// A section's genome (decision 0062): the sketch's genome with no master fade inside the track,
// extended when the section runs past the sketch's end, and the morph into the next section
// when their transition is one (0064).
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { morphGenome } from "../../src/domain/morph-genome.js";
import {
  renderedTransition,
  sectionGenome,
  sectionMorph,
  sectionWindow,
} from "../../src/domain/section-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { MORPH_HANDOVER } from "../../src/engine/morph.js";
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

describe("a morph between two sections", () => {
  // The same drone, quieter and with a wider sweep, as the second sketch; a pad only the first
  // has.
  const first = requireGenome(
    { ...droneGenome, voices: [...droneGenome.voices, { id: "pad", type: "pad", level: -14 }] },
    "first",
  );
  const second = requireGenome(
    { ...droneGenome, voices: [{ ...droneGenome.voices[0], level: -20, sweep: 2 }] },
    "second",
  );
  const genomes = new Map([
    [1, first],
    [2, second],
  ]);
  const track = {
    ...emptyArrangement(),
    sections: [
      { sketchId: 1, offset: 0, seconds: 30 },
      { sketchId: 2, offset: 10, seconds: 30 },
    ],
    transitions: [{ kind: "morph", seconds: 12, curve: "smooth" }],
  };
  const fitted = (/** @type {Genome} */ genome) => ({ ...genome, fadeIn: 0, fadeOut: 0 });

  test("the outgoing section plays the morph, which starts where the transition does", () => {
    const morph = morphGenome(
      { genome: fitted(first), at: 18 },
      { genome: fitted(second), at: 10 },
      12,
      "smooth",
    );
    expect(morph.ok).toBe(true);
    expect(sectionMorph(track, 0, genomes)).toEqual(morph);
    expect(sectionGenome(track, 0, genomes)).toEqual(morph.ok && morph.genome);
    expect(sectionGenome(track, 1, genomes)).toEqual(fitted(second));
    expect(sectionMorph(track, 1, genomes)).toBeNull();
  });

  test("the incoming section renders only from the handover, and the mix crossfades there", () => {
    const moves = 12 - MORPH_HANDOVER;
    expect(sectionWindow(track, 0, genomes)).toEqual({ offset: 0, duration: 30 });
    expect(sectionWindow(track, 1, genomes)).toEqual({ offset: 10 + moves, duration: 30 - moves });
    expect(renderedTransition(track, 0, genomes)).toEqual({
      kind: "morph",
      seconds: MORPH_HANDOVER,
      morphSeconds: 12,
      curve: "smooth",
    });
  });

  test("a morph that falls back plays as a crossfade of its seconds, and says why", () => {
    const apart = new Map([
      [1, first],
      [2, requireGenome({ ...second, scale: "aeolian" }, "aeolian")],
    ]);
    expect(sectionMorph(track, 0, apart)).toEqual({
      ok: false,
      reason: expect.stringMatching(/different scales/),
    });
    expect(sectionGenome(track, 0, apart)).toEqual(fitted(first));
    expect(sectionWindow(track, 1, apart)).toEqual({ offset: 10, duration: 30 });
    expect(renderedTransition(track, 0, apart)).toEqual({ kind: "crossfade", seconds: 12 });
  });
});

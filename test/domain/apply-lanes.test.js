// Macro lanes (decision 0065, acceptance 7): under a lane, each section's effective macro is its
// own value plus the lane's offset at every breakpoint, clamped to 0–1; a lane across a seam
// gives both sections the same offset there; a lane with no points changes nothing; a dense lane
// is capped at the trajectory's points and still matches at its breakpoints; lanes compose with
// a morph.
/** @import { Arrangement } from "../../src/domain/arrangement-schema.js" */
/** @import { Lane } from "../../src/domain/lane-schema.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Trajectory } from "../../src/engine/trajectory.js" */
import { describe, expect, test } from "vitest";
import { applyLanes } from "../../src/domain/apply-lanes.js";
import { sectionStarts } from "../../src/domain/arrangement-length.js";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { LANE_MOST_POINTS } from "../../src/domain/lane-schema.js";
import { sectionGenome, sectionMorph, sectionThinning } from "../../src/domain/section-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { isObject } from "../../src/engine/is-object.js";
import { LANE_POINTS, LANE_SAMPLE_SECONDS } from "../../src/engine/macro-lane.js";
import { MAX_POINTS, valueAt } from "../../src/engine/trajectory.js";
import { requireGenome } from "../../src/engine/validate-genome.js";

/** Sketch 1's brightness moves on its own; sketch 2's holds at 0.5. */
const MOVING = requireGenome(
  {
    ...droneGenome,
    macros: {
      brightness: {
        points: [
          [0, 0.3],
          [20, 0.8, "smooth"],
          [50, 0.4, "late"],
        ],
      },
    },
  },
  "moving",
);
const STILL = requireGenome({ ...droneGenome, macros: { brightness: 0.5 } }, "still");
const GENOMES = new Map([
  [1, MOVING],
  [2, STILL],
]);

/**
 * A macro's value on a genome's timeline.
 * @param {Genome} genome
 * @param {string} macro
 * @param {number} time
 */
function macroAt(genome, macro, time) {
  const value = /** @type {Record<string, number | Trajectory>} */ (genome.macros)[macro];
  if (value === undefined) throw new Error(`no macro ${macro}`);
  return isObject(value) ? valueAt(/** @type {Trajectory} */ (value), time, "linear") : value;
}

/** @param {number} value */
const clamped = (value) => Math.min(1, Math.max(0, value));

/**
 * The arrangement with these lanes.
 * @param {Arrangement} arrangement
 * @param {Lane[]} lanes
 * @returns {Arrangement}
 */
const withLanes = (arrangement, lanes) => ({ ...arrangement, lanes });

/** Two sections, starting at 0 and 34 on the track, overlapping by a 6 s crossfade. */
const TWO = Object.freeze({
  ...emptyArrangement(),
  sections: [
    { sketchId: 1, offset: 5, seconds: 40 },
    { sketchId: 2, offset: 10, seconds: 40 },
  ],
  transitions: [{ kind: "crossfade", seconds: 6 }],
});

/** A brightness lane with a breakpoint in the crossfade, at 37 s, and one that clamps, at 15 s. */
const BRIGHTNESS = /** @type {Lane} */ ({
  macro: "brightness",
  points: [
    [0, 0],
    [15, 0.4, "smooth"],
    [37, -0.4, "linear"],
    [60, 0.5, "early"],
    [74, 0.1, "late"],
  ],
});
/** One point: a constant offset on a macro both sketches leave at its default. */
const DENSITY = /** @type {Lane} */ ({ macro: "density", points: [[3, -0.2]] });

/**
 * Each lane breakpoint inside a section, with the time on the section's genome it falls at.
 * @param {Arrangement} arrangement
 * @param {number} index
 * @param {Lane} lane
 */
function breakpointsIn(arrangement, index, lane) {
  const start = /** @type {number} */ (sectionStarts(arrangement)[index]);
  const { offset, seconds } =
    /** @type {import("../../src/domain/arrangement-schema.js").Section} */ (
      arrangement.sections[index]
    );
  return lane.points
    .filter(([time]) => time >= start && time <= start + seconds)
    .map(([time, value]) => ({ time, value, at: offset + time - start }));
}

describe("applyLanes through sectionGenome", () => {
  const laned = withLanes(TWO, [BRIGHTNESS, DENSITY]);

  test("each section's macro is its own plus the lane's offset at every breakpoint, clamped (acceptance 7)", () => {
    let checked = 0;
    let clamps = 0;
    for (const index of [0, 1]) {
      const own = sectionGenome(TWO, index, GENOMES);
      const genome = sectionGenome(laned, index, GENOMES);
      for (const lane of [BRIGHTNESS, DENSITY]) {
        for (const { value, at } of breakpointsIn(laned, index, lane)) {
          const sum = macroAt(own, lane.macro, at) + value;
          if (sum > 1 || sum < 0) clamps++;
          expect(macroAt(genome, lane.macro, at)).toBeCloseTo(clamped(sum), 12);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
    // At 15 s of the track, 20 s on sketch 1, its own 0.8 and the lane's 0.4 clamp to 1.
    expect(clamps).toBeGreaterThanOrEqual(1);
  });

  test("the section's own motion is kept: its breakpoints and every 10 s of the track carry it", () => {
    const own = sectionGenome(TWO, 0, GENOMES);
    const genome = sectionGenome(laned, 0, GENOMES);
    const lane = { points: BRIGHTNESS.points };
    // Section 1 plays sketch 1 from 5 s: its own breakpoint at 20 s is at 15 s of the track,
    // and the grid's are at 10, 20, 30 and 40 s.
    for (const at of [5, 15, 20, 25, 35, 45]) {
      const offset = valueAt(/** @type {Trajectory} */ (lane), at - 5, "linear");
      expect(macroAt(genome, "brightness", at)).toBeCloseTo(
        clamped(macroAt(own, "brightness", at) + offset),
        12,
      );
    }
    expect(LANE_SAMPLE_SECONDS).toBe(10);
    // A one-point lane on a macro that holds still gives a number, not a trajectory.
    expect(genome.macros.density).toBeCloseTo(0.5 - 0.2, 12);
  });

  test("a lane across a seam gives both sections the same offset there", () => {
    const own = [0, 1].map((index) => sectionGenome(TWO, index, GENOMES));
    const genomes = [0, 1].map((index) => sectionGenome(laned, index, GENOMES));
    // The crossfade runs from 34 to 40 s of the track: 39 to 45 s on section 1's sketch, 10 to
    // 16 s on section 2's. The breakpoint at 37 s and the crossfade's end are on both.
    for (const [track, offset] of /** @type {[number, number][]} */ ([
      [37, -0.4],
      [40, valueAt(/** @type {Trajectory} */ ({ points: BRIGHTNESS.points }), 40, "linear")],
    ])) {
      const times = [5 + track, 10 + track - 34];
      const offsets = [0, 1].map(
        (i) =>
          macroAt(
            /** @type {Genome} */ (genomes[i]),
            "brightness",
            /** @type {number} */ (times[i]),
          ) -
          macroAt(/** @type {Genome} */ (own[i]), "brightness", /** @type {number} */ (times[i])),
      );
      expect(offsets[0]).toBeCloseTo(/** @type {number} */ (offset), 12);
      expect(offsets[1]).toBeCloseTo(/** @type {number} */ (offset), 12);
    }
  });

  test("a lane with no points changes no genome", () => {
    const empty = withLanes(TWO, [{ macro: "brightness", points: [] }]);
    for (const index of [0, 1]) {
      expect(sectionGenome(empty, index, GENOMES)).toEqual(sectionGenome(TWO, index, GENOMES));
    }
    const genome = sectionGenome(TWO, 0, GENOMES);
    const span = { at: 0, from: 5, to: 45 };
    expect(applyLanes(genome, [], span)).toBe(genome);
    expect(applyLanes(genome, [{ macro: "tension", points: [] }], span)).toBe(genome);
  });

  test("a dense lane is capped at the trajectory's points and still matches at its breakpoints", () => {
    expect(LANE_POINTS).toBe(MAX_POINTS);
    expect(LANE_MOST_POINTS).toBe(MAX_POINTS - 2);
    const one = {
      ...emptyArrangement(),
      sections: [{ sketchId: 1, offset: 0, seconds: 80 }],
    };
    const dense = /** @type {Lane} */ ({
      macro: "brightness",
      points: Array.from({ length: LANE_MOST_POINTS }, (_, i) =>
        i === 0 ? [1, 0.2] : [1 + i, i % 2 === 0 ? 0.2 : -0.3, "linear"],
      ),
    });
    const laned = withLanes(one, [dense]);
    const own = sectionGenome(one, 0, GENOMES);
    const genome = sectionGenome(laned, 0, GENOMES);
    const brightness = /** @type {Trajectory} */ (genome.macros.brightness);
    expect(brightness.points.length).toBe(LANE_POINTS);
    for (const { value, at } of breakpointsIn(laned, 0, dense)) {
      expect(macroAt(genome, "brightness", at)).toBeCloseTo(
        clamped(macroAt(own, "brightness", at) + value),
        12,
      );
    }
    // The section's two ends are kept too.
    expect(brightness.points[0]?.[0]).toBe(0);
    expect(brightness.points.at(-1)?.[0]).toBe(80);
  });
});

test("a lane with more than 62 − n breakpoints inside a section thins the section's own n", () => {
  // Sketch 1's brightness has its own breakpoints at 20 and 50 s; the lane's fall between
  // whole seconds, so none of them is one of its own.
  const one = { ...emptyArrangement(), sections: [{ sketchId: 1, offset: 0, seconds: 80 }] };
  /** @param {number} count */
  const lane = (count) =>
    /** @type {Lane} */ ({
      macro: "brightness",
      points: Array.from({ length: count }, (_, i) =>
        i === 0 ? [0.5, 0.1] : [0.5 + i, 0.1, "linear"],
      ),
    });
  /** @param {Arrangement} arrangement */
  const times = (arrangement) =>
    /** @type {Trajectory} */ (sectionGenome(arrangement, 0, GENOMES).macros.brightness).points.map(
      ([time]) => time,
    );
  // 61 lane points and 2 ends leave room for one of the two.
  const crowded = withLanes(one, [lane(61)]);
  expect(times(crowded).filter((time) => time === 20 || time === 50)).toHaveLength(1);
  expect(sectionThinning(crowded, 0, GENOMES)).toEqual(["brightness"]);
  // 60 leave room for both, and nothing is thinned.
  const room = withLanes(one, [lane(60)]);
  expect(times(room)).toEqual(expect.arrayContaining([20, 50]));
  expect(sectionThinning(room, 0, GENOMES)).toEqual([]);
  expect(sectionThinning(TWO, 0, GENOMES)).toEqual([]);
});

describe("lanes and a morph", () => {
  // Sketch 1 morphs into sketch 2 over 12 s, from 18 to 30 s of the track.
  const morphing = /** @type {Arrangement} */ ({
    ...emptyArrangement(),
    sections: [
      { sketchId: 1, offset: 0, seconds: 30 },
      { sketchId: 2, offset: 10, seconds: 30 },
    ],
    transitions: [{ kind: "morph", seconds: 12, curve: "smooth" }],
  });
  const lane = /** @type {Lane} */ ({
    macro: "brightness",
    points: [
      [0, 0.1],
      [22, -0.3, "linear"],
      [40, 0.2, "smooth"],
    ],
  });
  const laned = withLanes(morphing, [lane]);

  test("the morph's genome takes the lane's offsets on top of its own move", () => {
    const morph = sectionMorph(morphing, 0, GENOMES);
    expect(morph?.ok).toBe(true);
    const own = sectionGenome(morphing, 0, GENOMES);
    const genome = sectionGenome(laned, 0, GENOMES);
    for (const index of [0, 1]) {
      const plain = sectionGenome(morphing, index, GENOMES);
      const moved = sectionGenome(laned, index, GENOMES);
      for (const { value, at } of breakpointsIn(laned, index, lane)) {
        expect(macroAt(moved, "brightness", at)).toBeCloseTo(
          clamped(macroAt(plain, "brightness", at) + value),
          12,
        );
      }
    }
    // Only the laned macro changes: the morph's voices, instances and globals are as they were.
    expect({ ...genome, macros: own.macros }).toEqual(own);
    expect(sectionMorph(laned, 0, GENOMES)).toEqual(morph);
  });
});

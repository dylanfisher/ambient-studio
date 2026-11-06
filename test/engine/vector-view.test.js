/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { encode } from "../../src/engine/descriptor.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import { randomGenome } from "../../src/engine/random-genome.js";
import { validateGenome } from "../../src/engine/validate-genome.js";
import { fromVector, toVector, vectorPaths } from "../../src/engine/vector-view.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { fixtureVoice } from "../support/fixture-voice.js";

beforeAll(() => registerVoice(fixtureVoice));
afterAll(() => unregisterVoice(fixtureVoice.type));

/** @param {unknown} value @returns {Genome} */
function valid(value) {
  const result = validateGenome(value);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.genome;
}

/** @param {[number, number][]} pairs @returns {{ points: any[] }} */
const linearTrajectory = (pairs) => ({
  points: pairs.map(([t, v], i) => (i === 0 ? [t, v] : [t, v, "linear"])),
});

/**
 * Times and curves match exactly, values within float precision.
 * @param {unknown} actual
 * @param {{ points: any[] }} expected
 */
function expectPoints(actual, expected) {
  const { points } = /** @type {{ points: any[] }} */ (actual);
  expect(points).toHaveLength(expected.points.length);
  points.forEach(([time, value, curve], i) => {
    const [t, v, c] = expected.points[i];
    expect([time, curve]).toEqual([t, c]);
    expect(value).toBeCloseTo(v, 9);
  });
}

const shaped = () =>
  valid({
    reverbLevel: linearTrajectory([
      [0, -24],
      [60, -22],
      [120, -21],
      [200, -20],
    ]),
    macros: { space: 0.7 },
    voices: [
      {
        id: "a",
        type: "fixture",
        partials: 4,
        cutoff: {
          points: [
            [0, 200],
            [50, 400, "smooth"],
            [90, 800, "early"],
          ],
        },
      },
    ],
  });

describe("the vector view", () => {
  test("fromVector(toVector(g)) gives g back, for 50 random genomes over every numeric path", () => {
    for (let seed = 0; seed < 50; seed++) {
      const genome = randomGenome(seed);
      const paths = vectorPaths(genome);
      const vector = toVector(genome, paths);
      expect(vector).toHaveLength(paths.length);
      for (const u of vector) expect(u >= 0 && u <= 1).toBe(true);
      expect(fromVector(genome, paths, vector)).toEqual(genome);
    }
  });

  test("a moved position reads back within float precision", () => {
    const genome = shaped();
    const paths = ["width", "macros.space", "voices.a.cutoff.start", "voices.a.cutoff.end"];
    const moved = [0.2, 0.9, 0.31, 0.77];
    const back = toVector(fromVector(genome, paths, moved), paths);
    back.forEach((u, i) => {
      expect(u).toBeCloseTo(/** @type {number} */ (moved[i]), 12);
    });
  });

  test("lists every number and int, voices by id, trajectories as start and end", () => {
    const paths = vectorPaths(shaped());
    expect(paths).toContain("duration");
    expect(paths).toContain("reverbLevel.start");
    expect(paths).toContain("reverbLevel.end");
    expect(paths).not.toContain("reverbLevel");
    expect(paths).toContain("macros.space");
    expect(paths).toContain("voices.a.partials");
    expect(paths).toContain("voices.a.cutoff.end");
    expect(paths).not.toContain("tuning");
    expect(paths).not.toContain("voices.a.wave");
    expect(paths).not.toContain("voices.a.snap");
  });

  test("lists voices in id order, so reordering voices doesn't change the paths", () => {
    const voices = [
      { id: "b", type: "fixture" },
      { id: "a", type: "fixture" },
    ];
    const forward = vectorPaths(valid({ voices }));
    expect(vectorPaths(valid({ voices: voices.toReversed() }))).toEqual(forward);
    expect(forward.indexOf("voices.a.level")).toBeLessThan(forward.indexOf("voices.b.level"));
  });

  test("toVector throws on an enum or bool path", () => {
    const genome = shaped();
    expect(() => toVector(genome, ["tuning"])).toThrow(/tuning.*enum/);
    expect(() => toVector(genome, ["voices.a.wave"])).toThrow(/voices\.a\.wave.*enum/);
    expect(() => toVector(genome, ["voices.a.snap"])).toThrow(/voices\.a\.snap.*bool/);
  });

  test("a path that doesn't fit the genome throws", () => {
    const genome = shaped();
    expect(() => toVector(genome, ["reverbLevel"])).toThrow(/trajectory; use .start or .end/);
    expect(() => toVector(genome, ["width.start"])).toThrow(/not a trajectory/);
    expect(() => toVector(genome, ["voices.zz.level"])).toThrow(/no voice "zz"/);
    expect(() => toVector(genome, ["loudnes"])).toThrow(/unknown parameter "loudnes"/);
    expect(() => toVector(genome, ["key"])).not.toThrow();
    expect(() => toVector(valid({ tuning: "colundi", scale: "all" }), ["key"])).toThrow(/absent/);
    expect(() => fromVector(genome, ["width"], [0.1, 0.2])).toThrow(/1 path.*2 values/);
  });

  test("moving a trajectory's start and end keeps its interior shape and its curves", () => {
    const genome = shaped();
    const d = GLOBAL_PARAMS.reverbLevel;
    const moved = fromVector(
      genome,
      ["reverbLevel.start", "reverbLevel.end"],
      [encode(d, -30), encode(d, -10)],
    );
    // Interior values sat at 1/2 and 3/4 of the way from start to end; they still do.
    expectPoints(
      moved.reverbLevel,
      linearTrajectory([
        [0, -30],
        [60, -20],
        [120, -15],
        [200, -10],
      ]),
    );

    const cutoff = fixtureVoice.params.cutoff;
    const lifted = fromVector(genome, ["voices.a.cutoff.end"], [encode(cutoff, 1600)]);
    const { points } = /** @type {{ points: [number, number, string?][] }} */ (
      lifted.voices[0]?.cutoff ?? { points: [] }
    );
    // Along the log scale, 400 Hz sat halfway from 200 to 800; it now sits halfway to 1600.
    expect(points[1]?.[1]).toBeCloseTo(Math.sqrt(200 * 1600), 9);
    expect(points[1]?.[2]).toBe("smooth");
    expect(points[2]?.[2]).toBe("early");
    expect(points.map((p) => p[0])).toEqual([0, 50, 90]);
  });

  test("a trajectory that starts and ends on one value moves its interior with the ends, by time", () => {
    const genome = valid({
      reverbLevel: linearTrajectory([
        [0, -20],
        [50, -15],
        [100, -20],
      ]),
    });
    const d = GLOBAL_PARAMS.reverbLevel;
    const moved = fromVector(genome, ["reverbLevel.end"], [encode(d, -10)]);
    // The interior point sits halfway in time, so it takes half of the end's 10 dB.
    expectPoints(
      moved.reverbLevel,
      linearTrajectory([
        [0, -20],
        [50, -15 + 5],
        [100, -10],
      ]),
    );
  });

  test("a one-point trajectory has a start and no end", () => {
    const genome = valid({ reverbLevel: { points: [[30, -18]] } });
    expect(vectorPaths(genome)).toContain("reverbLevel.start");
    expect(vectorPaths(genome)).not.toContain("reverbLevel.end");
    expect(() => toVector(genome, ["reverbLevel.end"])).toThrow(/one point; use .start/);
  });

  test("fromVector leaves its input alone and throws when the result is invalid", () => {
    const genome = shaped();
    const before = structuredClone(genome);
    fromVector(genome, ["width"], [0]);
    expect(genome).toEqual(before);
    // The longest fades don't fit the shortest timeline.
    expect(() => fromVector(genome, ["duration", "fadeIn", "fadeOut"], [0, 1, 1])).toThrow(
      /fadeIn \+ fadeOut/,
    );
  });
});

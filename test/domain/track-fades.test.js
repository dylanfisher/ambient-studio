// A track's own fades (decision 0062): the first sketch's fade-in at the track's start and the
// last sketch's fade-out at its end, on the master bus's curve.
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { trackFadeGain, trackFades } from "../../src/domain/track-fades.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { CURVES } from "../../src/engine/trajectory.js";

const genomes = new Map([
  [1, { ...droneGenome, fadeIn: 3, fadeOut: 20 }],
  [2, { ...droneGenome, fadeIn: 10, fadeOut: 6 }],
]);

test("the track fades in as its first sketch does and out as its last does", () => {
  const arrangement = {
    ...emptyArrangement(),
    sections: [
      { sketchId: 1, offset: 10, seconds: 30 },
      { sketchId: 2, offset: 0, seconds: 30 },
    ],
    transitions: [{ kind: "crossfade", seconds: 5 }],
  };
  expect(trackFades(arrangement, genomes)).toEqual({ fadeIn: 3, fadeOut: 6 });
});

test("fades longer than the track are scaled down together to fit it", () => {
  const arrangement = {
    ...emptyArrangement(),
    sections: [{ sketchId: 1, offset: 0, seconds: 12 }],
  };
  const { fadeIn, fadeOut } = trackFades(arrangement, genomes);
  expect(fadeIn + fadeOut).toBeCloseTo(12, 12);
  expect(fadeIn / fadeOut).toBeCloseTo(3 / 20, 12);
  expect(trackFades(emptyArrangement(), genomes)).toEqual({ fadeIn: 0, fadeOut: 0 });
});

test("the gain follows the master bus's smooth curve at each frame's center", () => {
  const fades = { fadeIn: 100, fadeOut: 50, frames: 1000 };
  expect(trackFadeGain(0, fades)).toBe(CURVES.smooth(0.5 / 100));
  expect(trackFadeGain(99, fades)).toBe(CURVES.smooth(99.5 / 100));
  expect(trackFadeGain(100, fades)).toBe(1);
  expect(trackFadeGain(949, fades)).toBe(1);
  expect(trackFadeGain(950, fades)).toBe(CURVES.smooth(49.5 / 50));
  expect(trackFadeGain(999, fades)).toBe(CURVES.smooth(0.5 / 50));
  expect(trackFadeGain(5, { fadeIn: 0, fadeOut: 0, frames: 10 })).toBe(1);
});

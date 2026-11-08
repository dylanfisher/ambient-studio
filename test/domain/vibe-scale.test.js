// A direction's or a region's scale over the vibe's excerpts, 0 at the least and 1 at the most
// (decision 0056).
import { expect, test } from "vitest";
import { directionVector, projection } from "../../src/domain/direction-vector.js";
import {
  MIN_SCALE_EXCERPTS,
  MIN_SCALE_SPAN,
  scaledPosition,
  vibeScale,
} from "../../src/domain/vibe-scale.js";

test("projections order cards: 0 is the vibe's least excerpt, 1 its most, the rest between in order", () => {
  const direction = directionVector(new Float32Array([1, 0]), new Float32Array([0, 1]));
  const excerpts = [
    { id: "b", vector: new Float32Array([0.6, 0.8]) },
    { id: "a", vector: new Float32Array([1, 0]) },
    { id: "d", vector: new Float32Array([0, 1]) },
    { id: "c", vector: new Float32Array([0.8, 0.6]) },
  ];
  const values = excerpts.map(({ vector }) => projection(vector, direction));
  const scale = vibeScale(values);
  if (scale === null) throw new Error("four excerpts make a scale");
  const positions = excerpts.map(({ id }, i) => ({
    id,
    position: scaledPosition(/** @type {number} */ (values[i]), scale),
  }));
  const ordered = [...positions].sort((x, y) => x.position - y.position).map(({ id }) => id);
  expect(ordered).toEqual(["a", "c", "b", "d"]);
  expect(positions.find(({ id }) => id === "a")?.position).toBe(0);
  expect(positions.find(({ id }) => id === "d")?.position).toBe(1);
  // A sound past the vibe's most reads above 1, so a steer can move beyond what was made.
  expect(scaledPosition(scale.high + (scale.high - scale.low), scale)).toBeCloseTo(2, 12);
});

test("fewer than two excerpts, or excerpts that all project alike, have no scale", () => {
  expect(MIN_SCALE_EXCERPTS).toBe(2);
  expect(vibeScale([])).toBeNull();
  expect(vibeScale([0.3])).toBeNull();
  expect(vibeScale([0.3, 0.3])).toBeNull();
  expect(vibeScale([0.3, 0.1])).toEqual({ low: 0.1, high: 0.3 });
  // A spread under the least span is noise in the embeddings, not a scale.
  expect(vibeScale([0.3, 0.3 + MIN_SCALE_SPAN / 2])).toBeNull();
  expect(vibeScale([0.3, 0.3 + MIN_SCALE_SPAN])).not.toBeNull();
  expect(() => vibeScale([0.1, Number.NaN])).toThrow(/finite/);
});

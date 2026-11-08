// A CLAP direction between two ends, and a sound's projection on it (decision 0056).
import { expect, test } from "vitest";
import { directionVector, projection } from "../../src/domain/direction-vector.js";

/** @param {ArrayLike<number>} vector */
const rounded = (vector) => Array.from(vector, (value) => Number(value.toFixed(6)));

test("a direction is the normalized difference of its far end less its near end", () => {
  const near = new Float32Array([1, 0, 0]);
  const far = new Float32Array([0, 3, 4]);
  const direction = directionVector(near, far);
  // far − near is [-1, 3, 4], of length √26.
  const length = Math.sqrt(26);
  expect(rounded(direction)).toEqual(rounded([-1 / length, 3 / length, 4 / length]));
  expect(Math.hypot(...direction)).toBeCloseTo(1, 6);
});

test("a projection is the dot product with the direction, larger toward the far end", () => {
  const direction = directionVector(new Float32Array([1, 0]), new Float32Array([0, 1]));
  const nearer = projection(new Float32Array([0.9, 0.1]), direction);
  const farther = projection(new Float32Array([0.1, 0.9]), direction);
  expect(farther).toBeGreaterThan(nearer);
  expect(projection(new Float32Array([0, 1]), direction)).toBeCloseTo(Math.SQRT1_2, 6);
});

test("equal ends, ends of two lengths and a projection of another length throw", () => {
  expect(() => directionVector(new Float32Array([1, 0]), new Float32Array([1, 0]))).toThrow(/same/);
  expect(() => directionVector(new Float32Array(2), new Float32Array(3))).toThrow(/3 floats/);
  const direction = directionVector(new Float32Array([1, 0]), new Float32Array([0, 1]));
  expect(() => projection(new Float32Array(3), direction)).toThrow(/3 floats/);
});

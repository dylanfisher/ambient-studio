import { expect, test } from "vitest";
import { unitMean } from "../../src/domain/unit-mean.js";

/** @param {Float32Array} vector */
const rounded = (vector) => [...vector].map((value) => Number(value.toFixed(6)));

test("is the mean of the vectors scaled to length 1", () => {
  const mean = unitMean([new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])]);
  expect(rounded(mean)).toEqual([Math.SQRT1_2, Math.SQRT1_2, 0].map((v) => Number(v.toFixed(6))));
});

test("one vector is itself, scaled to length 1", () => {
  expect(rounded(unitMean([new Float32Array([0, 3, 4])]))).toEqual([0, 0.6, 0.8]);
});

test("no vectors, vectors of two lengths and a zero mean throw", () => {
  expect(() => unitMean([])).toThrow(/at least one/);
  expect(() => unitMean([new Float32Array(2), new Float32Array(3)])).toThrow(/3 floats/);
  expect(() => unitMean([new Float32Array([1, 0]), new Float32Array([-1, 0])])).toThrow(/zero/);
});

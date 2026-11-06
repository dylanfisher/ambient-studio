/** @import { Curve, Trajectory } from "../../src/engine/trajectory.js" */
import { describe, expect, test } from "vitest";
import { CURVES, valueAt } from "../../src/engine/trajectory.js";

/**
 * Rises from 100 to 400 over 10–30 s with `curve`, then falls linearly to 200 at 50 s.
 * @param {Curve} curve
 * @returns {Trajectory}
 */
const rise = (curve) => ({
  points: [
    [10, 100],
    [30, 400, curve],
    [50, 200, "linear"],
  ],
});

const curves = /** @type {Curve[]} */ (Object.keys(CURVES));

describe("valueAt", () => {
  test.each(curves)("is exact at every breakpoint with a %s curve, on either scale", (curve) => {
    for (const scale of /** @type {const} */ (["linear", "log"])) {
      expect(valueAt(rise(curve), 10, scale)).toBe(100);
      expect(valueAt(rise(curve), 30, scale)).toBe(400);
      expect(valueAt(rise(curve), 50, scale)).toBe(200);
    }
  });

  test("holds the first value before the first breakpoint and the last after the last", () => {
    expect(valueAt(rise("smooth"), 0, "linear")).toBe(100);
    expect(valueAt(rise("smooth"), 900, "linear")).toBe(200);
    expect(valueAt({ points: [[60, 7]] }, 0, "linear")).toBe(7);
    expect(valueAt({ points: [[60, 7]] }, 600, "linear")).toBe(7);
  });

  test("shapes a segment by its curve, along a linear scale", () => {
    // A quarter of the way through the 10–30 s segment.
    expect(valueAt(rise("linear"), 15, "linear")).toBeCloseTo(175, 12);
    expect(valueAt(rise("smooth"), 15, "linear")).toBeCloseTo(100 + 300 * 0.15625, 12);
    expect(valueAt(rise("early"), 15, "linear")).toBeCloseTo(100 + 300 * 0.4375, 12);
    expect(valueAt(rise("late"), 15, "linear")).toBeCloseTo(100 + 300 * 0.0625, 12);
    expect(valueAt(rise("smooth"), 20, "linear")).toBeCloseTo(250, 12);
    // The falling segment uses its own curve.
    expect(valueAt(rise("late"), 40, "linear")).toBeCloseTo(300, 12);
  });

  test("moves along a log scale geometrically", () => {
    expect(valueAt(rise("linear"), 20, "log")).toBeCloseTo(200, 9);
    expect(valueAt(rise("smooth"), 15, "log")).toBeCloseTo(100 * 4 ** 0.15625, 9);
    expect(valueAt(rise("early"), 15, "log")).toBeCloseTo(100 * 4 ** 0.4375, 9);
  });

  test.each(curves)("a %s segment stays between its ends and never turns back", (curve) => {
    let previous = 100;
    for (let t = 10; t <= 30; t += 0.25) {
      const value = valueAt(rise(curve), t, "linear");
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(400);
      previous = value;
    }
  });

  test("a time that isn't a finite number throws", () => {
    expect(() => valueAt(rise("linear"), Number.NaN, "linear")).toThrow(/time/);
  });
});

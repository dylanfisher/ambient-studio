import { describe, expect, test } from "vitest";
import { number } from "../../src/engine/descriptor.js";
import { highestValue as highestOf } from "../../src/engine/highest-value.js";

const rate = number({
  min: 1,
  max: 100,
  default: 10,
  unit: "/s",
  scale: "log",
  trajectory: true,
  description: "x",
});
const neutral = {
  brightness: 0.5,
  density: 0.5,
  motion: 0.5,
  space: 0.5,
  warmth: 0.5,
  tension: 0.5,
};
/** @type {import("../../src/engine/macro-table.js").MacroRow[]} */
const rows = [{ macro: "density", param: "rate", depth: 0.25 }];

/**
 * `highestValue` for a voice whose only parameter, `rate`, holds `value`.
 * @param {unknown} value
 * @param {readonly import("../../src/engine/macro-table.js").MacroRow[]} macroRows
 * @param {unknown} macros
 */
const highestValue = (value, macroRows, macros) =>
  highestOf(/** @type {any} */ ({ macros }), { rate: value }, "rate", rate, macroRows);

describe("highestValue", () => {
  test("is the value itself with neutral macros", () => {
    expect(highestValue(10, rows, neutral)).toBeCloseTo(10, 9);
  });

  test("is a trajectory's highest point, since every curve stays between its points", () => {
    const swept = {
      points: [
        [0, 5],
        [10, 40, "smooth"],
        [20, 2, "late"],
      ],
    };
    expect(highestValue(/** @type {any} */ (swept), rows, neutral)).toBeCloseTo(40, 9);
  });

  test("adds the most a macro's highest point shifts it, and the least for a negative depth", () => {
    const up = {
      ...neutral,
      density: {
        points: [
          [0, 0.2],
          [30, 1],
        ],
      },
    };
    // A quarter of 2 decades up from 10 is half a decade.
    expect(highestValue(10, rows, /** @type {any} */ (up))).toBeCloseTo(10 * Math.sqrt(10), 9);
    // At its lowest point, 0.2, a depth of -0.25 shifts it up by 0.15 of the range.
    const down = [{ ...rows[0], depth: -0.25 }];
    expect(highestValue(10, /** @type {any} */ (down), /** @type {any} */ (up))).toBeCloseTo(
      10 * 10 ** 0.3,
      9,
    );
  });

  test("ignores rows on other parameters and clamps to the range", () => {
    const other = [{ macro: /** @type {const} */ ("density"), param: "other", depth: 1 }];
    expect(highestValue(10, other, { ...neutral, density: 1 })).toBeCloseTo(10, 9);
    const far = [{ macro: /** @type {const} */ ("density"), param: "rate", depth: 1 }];
    expect(highestValue(50, far, { ...neutral, density: 1 })).toBe(100);
  });
});

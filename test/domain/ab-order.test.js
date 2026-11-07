import { describe, expect, test } from "vitest";
import { AB_ORDER_SEEDS, abOrder } from "../../src/domain/ab-order.js";

describe("abOrder", () => {
  test("a seed always gives the same side", () => {
    for (const seed of [0, 1, 7, 2 ** 31, AB_ORDER_SEEDS - 1]) {
      expect(abOrder(seed)).toBe(abOrder(seed));
      expect(["a", "b"]).toContain(abOrder(seed));
    }
  });

  test("over 200 seeds, side a is on the left between 40% and 60% of the time", () => {
    const seeds = Array.from({ length: 200 }, (_, seed) => seed);
    const aFirst = seeds.filter((seed) => abOrder(seed) === "a").length;
    expect(aFirst / seeds.length).toBeGreaterThanOrEqual(0.4);
    expect(aFirst / seeds.length).toBeLessThanOrEqual(0.6);
  });

  test("a seed outside [0, 2^32) or not an integer throws", () => {
    for (const seed of [-1, AB_ORDER_SEEDS, 1.5, Number.NaN]) {
      expect(() => abOrder(seed)).toThrow(/seed/);
    }
  });
});

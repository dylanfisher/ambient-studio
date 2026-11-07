import { describe, expect, test } from "vitest";
import { exactMcNemar } from "../../src/domain/exact-mcnemar.js";

describe("exactMcNemar", () => {
  // One-sided: P(X >= b) for X ~ Binomial(b + c, 1/2), worked by hand.
  test.each([
    [9, 1, 11 / 1024],
    [5, 0, 1 / 32],
    [0, 5, 1],
    [0, 0, 1],
    [3, 3, 42 / 64],
    [18, 2, 211 / 2 ** 20],
  ])("%i treatment only against %i control only gives the hand-worked p", (b, c, p) => {
    expect(exactMcNemar(b, c)).toBeCloseTo(p, 15);
  });

  test("stays finite where 2^n leaves a double's range", () => {
    expect(exactMcNemar(600, 600)).toBeGreaterThan(0.5);
    expect(exactMcNemar(600, 600)).toBeLessThan(0.52);
    expect(exactMcNemar(1200, 0)).toBe(0);
  });

  test("refuses counts that aren't whole numbers from 0", () => {
    expect(() => exactMcNemar(-1, 2)).toThrow(/whole numbers/);
    expect(() => exactMcNemar(1.5, 2)).toThrow(/whole numbers/);
  });
});

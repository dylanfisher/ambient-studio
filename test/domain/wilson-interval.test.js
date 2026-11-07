import { describe, expect, test } from "vitest";
import { wilsonInterval } from "../../src/domain/wilson-interval.js";

describe("wilsonInterval", () => {
  // Newcombe, "Two-sided confidence intervals for the single proportion: comparison of seven
  // methods", Statistics in Medicine 17 (1998), Table I, method 3 (score, no continuity
  // correction), given to four places.
  test.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ])("%i of %i matches Newcombe's published 95%% interval", (successes, trials, low, high) => {
    const interval = wilsonInterval(successes, trials);
    expect(interval.low).toBeCloseTo(low, 4);
    expect(interval.high).toBeCloseTo(high, 4);
  });

  test("45 of 48, the acceptance case, is about 83% to 98%", () => {
    const { low, high } = wilsonInterval(45, 48);
    expect(low).toBeCloseTo(0.8316, 4);
    expect(high).toBeCloseTo(0.9785, 4);
  });

  test("every success and no success stay inside 0 to 1", () => {
    expect(wilsonInterval(0, 5).low).toBe(0);
    expect(wilsonInterval(5, 5).high).toBe(1);
  });

  test.each([
    [1, 0],
    [3, 2],
    [-1, 4],
    [1.5, 4],
  ])("%s of %s throws", (successes, trials) => {
    expect(() => wilsonInterval(successes, trials)).toThrow(/successes/);
  });
});

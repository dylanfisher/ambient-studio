// The map's fill job's explore share (decision 0057): which steps ask the language model.
import { expect, test } from "vitest";
import { exploreSteps, isExploreStep } from "../../src/domain/fill-settings.js";

test("a share of the steps explore, spread through the run, and none by default", () => {
  const steps = (/** @type {number} */ share) =>
    Array.from({ length: 12 }, (_, step) => step).filter((step) => isExploreStep(step, share));
  expect(steps(0)).toEqual([]);
  expect(steps(0.25)).toEqual([3, 7, 11]);
  expect(steps(1)).toHaveLength(12);
  expect(exploreSteps(12, 0.25)).toBe(steps(0.25).length);
  expect(exploreSteps(10, 0.15)).toBe(
    Array.from({ length: 10 }, (_, step) => step).filter((step) => isExploreStep(step, 0.15))
      .length,
  );
});

// The terms a steer adds to the search score: each direction's distance from its setting, and
// each region's similarity (decision 0056).
import { expect, test } from "vitest";
import { directionVector } from "../../src/domain/direction-vector.js";
import { searchScore, termsScore } from "../../src/domain/search-score.js";
import { DIRECTION_WEIGHT, REGION_WEIGHT, steerTerms } from "../../src/domain/steer-terms.js";

const direction = {
  vector: directionVector(new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])),
  scale: { low: -0.5, high: 0.5 },
};

test("a direction's term is highest at its setting and falls off either side", () => {
  /** @param {number} x @param {number} setting */
  const value = (x, setting) =>
    termsScore(
      steerTerms(Float32Array.from([1 - x, x, 0]), {
        directions: [{ ...direction, setting }],
        regions: [],
      }),
    );
  // At x = 0.5 the projection is 0, the middle of the scale.
  expect(value(0.5, 0.5)).toBeCloseTo(0, 12);
  expect(value(0.5, 1)).toBeLessThan(0);
  expect(value(0.9, 1)).toBeGreaterThan(value(0.5, 1));
  expect(value(0.1, 0)).toBeGreaterThan(value(0.5, 0));
  expect(DIRECTION_WEIGHT).toBeGreaterThan(1);
});

test("a region term pulls the best of scripted points toward the region", () => {
  const region = { vector: new Float32Array([0, 0, 1]), scale: { low: 0, high: 1 } };
  const points = [
    Float32Array.from([1, 0, 0]),
    Float32Array.from([0.8, 0, 0.6]),
    Float32Array.from([0.6, 0, 0.8]),
    Float32Array.from([0, 1, 0]),
  ];
  const scores = points.map((embedding) =>
    termsScore(steerTerms(embedding, { directions: [], regions: [region] })),
  );
  expect(scores.indexOf(Math.max(...scores))).toBe(2);
  expect(REGION_WEIGHT).toBeGreaterThan(1);
});

test("a region term is held in 0 to 1, so a sound past the vibe's nearest can't outbid a direction at its setting", () => {
  // The scale's high end is below the region itself, so the region reads past 1.
  const region = { vector: new Float32Array([0, 0, 1]), scale: { low: 0, high: 0.5 } };
  const [term] = steerTerms(Float32Array.from([0, 0, 1]), { directions: [], regions: [region] });
  expect(term?.value).toBe(1);
  const [far] = steerTerms(Float32Array.from([0, 1, 0]), {
    directions: [],
    regions: [{ ...region, scale: { low: 0.2, high: 0.5 } }],
  });
  expect(far?.value).toBe(0);
});

test("with no terms, the search score is exactly the model's lower bound", () => {
  const terms = steerTerms(Float32Array.from([1, 0, 0]), { directions: [], regions: [] });
  expect(terms).toEqual([]);
  expect(searchScore(0.5, 0.04, terms)).toBe(searchScore(0.5, 0.04));
  expect(searchScore(0.5, 0.04, terms)).toBe(0.5 - Math.sqrt(0.04));
  expect(termsScore([])).toBe(0);
});

test("the model's score is added to the terms with weight 1, small beside them", () => {
  const terms = [{ value: -0.25, weight: DIRECTION_WEIGHT }];
  expect(searchScore(0.5, 0, terms)).toBeCloseTo(0.5 - 0.25 * DIRECTION_WEIGHT, 12);
  expect(() => termsScore([{ value: Number.NaN, weight: 1 }])).toThrow(/finite/);
});

import { describe, expect, test } from "vitest";
import { percentiles } from "../../src/domain/percentiles.js";

describe("percentiles", () => {
  test("takes the nearest rank, in any input order", () => {
    const values = Array.from({ length: 20 }, (_, i) => (i * 7) % 20).map((i) => (i + 1) * 10);
    expect(percentiles(values)).toEqual({ count: 20, p50: 100, p90: 180, p95: 190, max: 200 });
  });

  test("one value is every percentile", () => {
    expect(percentiles([42])).toEqual({ count: 1, p50: 42, p90: 42, p95: 42, max: 42 });
  });

  test("no values throws, and so does a value that isn't a finite number", () => {
    expect(() => percentiles([])).toThrow(/no values/);
    expect(() => percentiles([1, Number.NaN])).toThrow(/finite/);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { centsToRatio, loadTuning } from "../../src/engine/tuning.js";
import { getTuning } from "../../src/engine/tuning-registry.js";

/** @param {string} name */
const fixture = (name) =>
  readFileSync(new URL(`../fixtures/tunings/${name}`, import.meta.url), "utf8");

/** @param {number} hz @param {number} baseHz */
const centsAbove = (hz, baseHz) => 1200 * Math.log2(hz / baseHz);

describe("centsToRatio", () => {
  test("turns cents into a frequency ratio", () => {
    expect(centsToRatio(0)).toBe(1);
    expect(centsToRatio(1200)).toBe(2);
    expect(centsToRatio(-1200)).toBe(0.5);
    expect(centsToRatio(700)).toBeCloseTo(1.4983070768766815, 15);
  });
});

describe("relative tunings", () => {
  test("a .scl file with cents lines, ratio lines and comments loads to the same tuning as the equivalent JSON file", () => {
    const json = JSON.parse(fixture("mixed.json"));
    const { period: _period, degrees: _degrees, ...rest } = json;
    const fromScl = loadTuning("mixed", { ...rest, scala: fixture("mixed.scl") });
    const fromJson = loadTuning("mixed", json);
    expect(fromScl).toEqual(fromJson);
    expect(fromJson.kind === "relative" && fromJson.degrees).toEqual([
      1,
      centsToRatio(100),
      9 / 8,
      centsToRatio(316),
      5 / 4,
      4 / 3,
      centsToRatio(701.955),
      5 / 3,
    ]);
  });

  test("equal steps divide the period evenly, in octaves or not", () => {
    const tuning = loadTuning("bp", {
      name: "13 over 3/1",
      period: "3/1",
      steps: 13,
      reference: { degree: 0, octave: 0, hz: 100 },
      scales: {},
    });
    expect(tuning.kind === "relative" && tuning.period).toBe(3);
    expect(tuning.kind === "relative" && tuning.degrees[13 - 1]).toBe(3 ** (12 / 13));
  });

  test("every tuning has an `all` scale listing each degree", () => {
    const tuning = loadTuning("t", {
      name: "T",
      period: 1200,
      steps: 5,
      reference: { degree: 0, octave: 0, hz: 100 },
      scales: { two: [0, 3] },
    });
    expect(tuning.scales).toEqual({ all: [0, 1, 2, 3, 4], two: [0, 3] });
  });

  test("a scale must start at degree 0, rise, and stay inside the tuning", () => {
    /** @param {number[]} scale */
    const withScale = (scale) => () =>
      loadTuning("t", {
        name: "T",
        period: "2/1",
        steps: 12,
        reference: { degree: 0, octave: 0, hz: 100 },
        scales: { bad: scale },
      });
    expect(withScale([2, 4])).toThrow(/t: scale "bad"/);
    expect(withScale([0, 4, 4])).toThrow(/t: scale "bad"/);
    expect(withScale([0, 12])).toThrow(/t: scale "bad"/);
    expect(withScale([0, 1.5])).toThrow(/t: scale "bad"/);
  });

  test("rejects degrees that don't rise below the period, and malformed files", () => {
    /** @param {Record<string, unknown>} change */
    const load = (change) => () =>
      loadTuning("t", {
        name: "T",
        period: "2/1",
        degrees: [100, "3/2"],
        reference: { degree: 0, octave: 0, hz: 100 },
        scales: {},
        ...change,
      });
    expect(load({})).not.toThrow();
    expect(load({ degrees: ["3/2", 100] })).toThrow(/rise/);
    expect(load({ degrees: [100, 1200] })).toThrow(/below the period/);
    expect(load({ degrees: ["-3/2"] })).toThrow(/ratio/);
    expect(load({ degrees: ["3/0"] })).toThrow(/ratio/);
    expect(load({ steps: 12 })).toThrow(/one of/);
    expect(load({ period: 0 })).toThrow(/period/);
    expect(load({ reference: { degree: 3, octave: 0, hz: 100 } })).toThrow(/reference/);
    expect(load({ reference: { degree: 0, octave: 0, hz: -1 } })).toThrow(/reference/);
    expect(load({ scales: { all: [0] } })).toThrow(/"all"/);
    expect(load({ root: 3 })).toThrow(/unknown key "root"/);
  });

  test("rejects a malformed .scl file", () => {
    /** @param {string} scala */
    const load = (scala) => () =>
      loadTuning("t", {
        name: "T",
        scala,
        reference: { degree: 0, octave: 0, hz: 100 },
        scales: {},
      });
    expect(load("desc\n2\n100.0\n2/1\n")).not.toThrow();
    expect(load("desc\n3\n100.0\n2/1\n")).toThrow(/3 pitches, found 2/);
    expect(load("desc\n1\n100.0\n2/1\n")).toThrow(/1 pitches, found 2/);
    expect(load("desc\nmany\n100.0\n")).toThrow(/count/);
    expect(load("desc\n1\nfifth\n")).toThrow(/line 3/);
    expect(load("desc\n1\n-3/2\n")).toThrow(/line 3/);
    expect(load("")).toThrow(/count/);
  });
});

describe("absolute tunings", () => {
  test("a .scl file read at a base frequency gives count + 1 degrees from the base", () => {
    const colundi = loadTuning("colundi-scl", {
      name: "Colundi from Scala",
      scala: fixture("colundi.scl"),
      baseHz: 10.8,
      scales: {},
    });
    if (colundi.kind !== "absolute") throw new Error("expected an absolute tuning");
    expect(colundi.frequencies).toHaveLength(128);
    expect(colundi.frequencies[0]).toBe(10.8);
    expect(Math.abs((colundi.frequencies[78] ?? 0) - 440)).toBeLessThan(0.001);
    const shipped = getTuning("colundi");
    if (shipped.kind !== "absolute") throw new Error("expected an absolute tuning");
    colundi.frequencies.forEach((hz, degree) => {
      expect(Math.abs(hz - (shipped.frequencies[degree] ?? 0))).toBeLessThan(0.001);
    });
  });

  test("every degree of the 37-line subset file is a degree of the 127-line one", () => {
    /** @param {string} name */
    const load = (name) => {
      const tuning = loadTuning(name, {
        name,
        scala: fixture(name),
        baseHz: 10.8,
        scales: {},
      });
      if (tuning.kind !== "absolute") throw new Error("expected an absolute tuning");
      return tuning.frequencies;
    };
    const full = load("colundi.scl");
    const subset = load("colundi-subset38.scl");
    expect(subset).toHaveLength(38);
    for (const hz of subset) {
      const nearest = Math.min(
        ...full.map((other) => Math.abs(centsAbove(hz, 10.8) - centsAbove(other, 10.8))),
      );
      expect(nearest).toBeLessThan(0.001);
    }
  });

  test("scales are listed in Hz and stored as degree indices", () => {
    const tuning = loadTuning("a", {
      name: "A",
      frequencies: [10, 20, 35.5, 40],
      scales: { some: [20, 40] },
    });
    expect(tuning.scales).toEqual({ all: [0, 1, 2, 3], some: [1, 3] });
  });

  test("rejects unsorted frequencies, non-member scale values and a key", () => {
    /** @param {Record<string, unknown>} change */
    const load = (change) => () =>
      loadTuning("a", {
        name: "A",
        frequencies: [10, 20, 40],
        scales: {},
        ...change,
      });
    expect(load({ frequencies: [10, 40, 20] })).toThrow(/rise/);
    expect(load({ frequencies: [0, 20] })).toThrow(/positive/);
    expect(load({ scales: { some: [20, 30] } })).toThrow(/30 Hz is not a frequency/);
    expect(load({ scales: { some: [40, 20] } })).toThrow(/rise/);
    expect(load({ reference: { degree: 0, octave: 0, hz: 10 } })).toThrow(/unknown key/);
    expect(load({ scala: "x\n0\n" })).toThrow(/one of/);
    expect(load({ frequencies: undefined, scala: "x\n0\n", baseHz: 0 })).toThrow(/baseHz/);
    expect(load({ baseHz: 10 })).toThrow(/"baseHz" only goes with "scala"/);
  });
});

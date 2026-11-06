import { describe, expect, test } from "vitest";
import { frequency, resolvePitch, tuningFrequencies } from "../../src/engine/pitch.js";
import { centsToRatio, loadTuning } from "../../src/engine/tuning.js";
import { getTuning } from "../../src/engine/tuning-registry.js";

const tet12 = getTuning("12-tet");
const colundi = getTuning("colundi");
const colundiHz = colundi.kind === "absolute" ? colundi.frequencies : [];

/** @param {number} a @param {number} b */
const relativeError = (a, b) => Math.abs(a - b) / b;

describe("relative tunings", () => {
  test("A4 = 440 Hz in 12-TET", () => {
    expect(frequency(resolvePitch(tet12, "all", 9), 0, 4)).toBe(440);
    expect(frequency(resolvePitch(tet12, "all", 0), 9, 4)).toBe(440);
    expect(frequency(resolvePitch(tet12, "all", 0), 0, 4)).toBeCloseTo(261.6255653, 6);
  });

  test("D dorian's degrees", () => {
    const pitch = resolvePitch(tet12, "dorian", 2);
    const hz = [0, 1, 2, 3, 4, 5, 6, 7].map((degree) => frequency(pitch, degree, 4));
    const expected = [293.6648, 329.6276, 349.2282, 391.9954, 440, 493.8833, 523.2511, 587.3295];
    hz.forEach((value, i) => {
      expect(value).toBeCloseTo(expected[i] ?? 0, 3);
    });
  });

  test("a just fifth is exactly 3/2", () => {
    const pitch = resolvePitch(getTuning("just-5-limit"), "ionian", 0);
    expect(frequency(pitch, 4, 4)).toBe(frequency(pitch, 0, 4) * 1.5);
  });

  test("custom cents shift by the stated amount", () => {
    const custom = loadTuning("custom", {
      name: "Custom",
      period: 1200,
      degrees: [150, 380, 777.7],
      reference: { degree: 0, octave: 0, hz: 100 },
      scales: {},
    });
    const pitch = resolvePitch(custom, "all", 0);
    [0, 150, 380, 777.7, 1200].forEach((cents, degree) => {
      const shift = 1200 * Math.log2(frequency(pitch, degree, 0) / 100);
      expect(shift).toBeCloseTo(cents, 9);
    });
  });

  test("out-of-range degrees wrap octaves", () => {
    const pitch = resolvePitch(tet12, "ionian", 0);
    expect(frequency(pitch, 7, 4)).toBe(frequency(pitch, 0, 5));
    expect(frequency(pitch, 15, 4)).toBe(frequency(pitch, 1, 6));
    expect(frequency(pitch, -1, 4)).toBe(frequency(pitch, 6, 3));
    expect(frequency(pitch, -8, 4)).toBe(frequency(pitch, 6, 2));
    expect(frequency(pitch, 0, 5)).toBe(2 * frequency(pitch, 0, 4));
  });

  test("a key carries scale degrees past the period into the next octave", () => {
    const aMinor = resolvePitch(tet12, "aeolian", 9);
    expect(frequency(aMinor, 0, 4)).toBe(440);
    expect(frequency(aMinor, 2, 4)).toBe(frequency(resolvePitch(tet12, "all", 0), 0, 5));
  });

  test("19-EDO gives the expected frequencies", () => {
    const pitch = resolvePitch(getTuning("19-edo"), "all", 0);
    const base = frequency(pitch, 0, 4);
    expect(base).toBeCloseTo(261.6255653, 6);
    for (const step of [1, 6, 11, 18, 19, 25, -3]) {
      expect(relativeError(frequency(pitch, step, 4), base * 2 ** (step / 19))).toBeLessThan(1e-12);
    }
  });

  test("13 equal steps over 3/1 give the expected frequencies", () => {
    const pitch = resolvePitch(getTuning("bohlen-pierce"), "all", 0);
    const base = frequency(pitch, 0, 0);
    for (const step of [1, 4, 12, 13, 20, -1]) {
      expect(relativeError(frequency(pitch, step, 0), base * 3 ** (step / 13))).toBeLessThan(1e-12);
    }
    expect(relativeError(frequency(pitch, 0, 1), 3 * base)).toBeLessThan(1e-12);
  });

  test("tuningFrequencies returns only scale members inside the band", () => {
    const pitch = resolvePitch(tet12, "minor-pentatonic", 9);
    const members = [9, 0, 2, 4, 7];
    const hz = tuningFrequencies(pitch, 100, 500);
    expect(hz).toHaveLength(11);
    expect(hz[0]).toBeCloseTo(110, 9);
    expect(hz).toContain(440);
    for (const value of hz) {
      expect(value).toBeGreaterThanOrEqual(100);
      expect(value).toBeLessThanOrEqual(500);
      const semitone = Math.round(12 * Math.log2(value / 440)) + 9;
      expect(members).toContain(((semitone % 12) + 12) % 12);
    }
    expect(hz).toEqual([...hz].sort((a, b) => a - b));
  });

  test("rejects a missing key or octave, a key outside the tuning and an unknown scale", () => {
    expect(() => resolvePitch(tet12, "dorian")).toThrow(/needs a key/);
    expect(() => resolvePitch(tet12, "dorian", 12)).toThrow(/key 12/);
    expect(() => resolvePitch(tet12, "dorian", 1.5)).toThrow(/key 1.5/);
    expect(() => resolvePitch(tet12, "blues", 0)).toThrow(/no scale "blues"/);
    const pitch = resolvePitch(tet12, "dorian", 2);
    expect(() => frequency(pitch, 0)).toThrow(/octave/);
    expect(() => frequency(pitch, 0.5, 4)).toThrow(/degree/);
  });
});

describe("absolute tunings", () => {
  test("every Colundi degree returns its listed Hz exactly", () => {
    const pitch = resolvePitch(colundi, "all");
    expect(colundiHz).toHaveLength(128);
    colundiHz.forEach((hz, degree) => {
      expect(frequency(pitch, degree)).toBe(hz);
    });
  });

  test("a scale picked from Colundi returns only member frequencies", () => {
    for (const [name, size] of /** @type {const} */ ([
      ["subset38", 38],
      ["core36", 36],
      ["core18", 18],
    ])) {
      const pitch = resolvePitch(colundi, name);
      const hz = Array.from({ length: size }, (_, degree) => frequency(pitch, degree));
      for (const value of hz) expect(colundiHz).toContain(value);
      expect(new Set(hz).size).toBe(size);
    }
    expect(frequency(resolvePitch(colundi, "subset38"), 28)).toBe(440);
  });

  test("key or octave on an absolute tuning throws, as does an out-of-range degree", () => {
    expect(() => resolvePitch(colundi, "subset38", 0)).toThrow(/no key/);
    const pitch = resolvePitch(colundi, "subset38");
    expect(() => frequency(pitch, 0, 4)).toThrow(/no octave/);
    expect(() => frequency(pitch, 38)).toThrow(/degree 38/);
    expect(() => frequency(pitch, -1)).toThrow(/degree -1/);
  });

  test("tuningFrequencies returns only scale members inside the band", () => {
    const pitch = resolvePitch(colundi, "core18");
    expect(tuningFrequencies(pitch, 100, 250)).toEqual([
      105, 126.22, 140.25, 160, 172.06, 197, 221.23, 250,
    ]);
    expect(tuningFrequencies(resolvePitch(colundi, "all"), 33, 40)).toEqual([
      33, 33.8, 35, 38, 39, 40,
    ]);
    expect(tuningFrequencies(pitch, 10, 20)).toEqual([]);
  });

  test("tuningFrequencies rejects an empty or non-positive band", () => {
    const pitch = resolvePitch(colundi, "all");
    expect(() => tuningFrequencies(pitch, 500, 100)).toThrow(/band/);
    expect(() => tuningFrequencies(pitch, 0, 100)).toThrow(/band/);
  });
});

test("centsToRatio and the 12-TET file agree on a semitone", () => {
  const pitch = resolvePitch(tet12, "all", 0);
  expect(frequency(pitch, 1, 4) / frequency(pitch, 0, 4)).toBeCloseTo(centsToRatio(100), 15);
});

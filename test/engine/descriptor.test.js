import { describe, expect, test } from "vitest";
import { choice, decode, encode, flag, int, number } from "../../src/engine/descriptor.js";

const linear = number({ min: -30, max: -6, default: -12, unit: "dB", description: "x" });
const log = number({
  min: 100,
  max: 1600,
  default: 400,
  unit: "Hz",
  scale: "log",
  description: "x",
});
const count = int({ min: 1, max: 12, default: 6, unit: "", description: "x" });

describe("descriptors", () => {
  test("a default outside the range or values throws when the table is built", () => {
    expect(() => number({ min: 0, max: 1, default: 2, unit: "", description: "x" })).toThrow(
      /default 2 is outside 0\.\.1/,
    );
    expect(() => int({ min: 0, max: 4, default: 1.5, unit: "", description: "x" })).toThrow(
      /whole/,
    );
    expect(() =>
      choice({ values: ["a"], default: /** @type {any} */ ("b"), description: "x" }),
    ).toThrow(/default "b"/);
    expect(() =>
      number({ min: 0, max: 1, default: 0.5, unit: "", scale: "log", description: "x" }),
    ).toThrow(/log scale needs min > 0/);
  });

  test("a safe range outside the range, or empty, throws when the table is built", () => {
    const spec = { min: 0, max: 1, default: 0.5, unit: "", description: "x" };
    expect(() => number({ ...spec, safe: [0.2, 1.5] })).toThrow(/safe range 0\.2\.\.1\.5/);
    expect(() => number({ ...spec, safe: [0.6, 0.4] })).toThrow(/safe range/);
    expect(number({ ...spec, safe: [0.2, 0.6] }).safe).toEqual([0.2, 0.6]);
  });

  test("encode maps the range to 0..1 along the scale, and decode inverts it", () => {
    expect(encode(linear, -30)).toBe(0);
    expect(encode(linear, -6)).toBe(1);
    expect(encode(linear, -18)).toBe(0.5);
    expect(encode(log, 400)).toBeCloseTo(0.5, 12);
    expect(decode(log, 0.5)).toBeCloseTo(400, 9);
    for (const u of [0, 0.1, 0.37, 0.9, 1]) {
      expect(encode(linear, decode(linear, u))).toBeCloseTo(u, 12);
      expect(encode(log, decode(log, u))).toBeCloseTo(u, 12);
    }
  });

  test("decode clamps to the range and rounds an int", () => {
    expect(decode(linear, 1.5)).toBe(-6);
    expect(decode(log, -1)).toBe(100);
    expect(decode(count, 0.5)).toBe(7);
  });

  test("an enum or bool has no vector encoding", () => {
    const wave = choice({ values: ["sine", "saw"], default: "sine", description: "x" });
    expect(() => encode(wave, 0)).toThrow(/enum/);
    expect(() => decode(flag({ default: true, description: "x" }), 0)).toThrow(/bool/);
  });
});

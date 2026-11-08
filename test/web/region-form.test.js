// The References page's region form (decision 0050), with no DOM: typed times, a drag on the
// peak strip, and the checks the server makes too.
import { describe, expect, test } from "vitest";
import { REGION_SECONDS, regionProblem } from "../../src/domain/reference-region.js";
import {
  dragRegion,
  formatSeconds,
  parseSeconds,
  REGION_INPUT,
  readRegion,
  regionValues,
  spanQuery,
} from "../../src/web/region-form.js";

/**
 * Reads the form's values from a plain record, the way FormData's get would.
 * @param {Record<string, string>} values
 */
const getter = (values) => (/** @type {string} */ name) => values[name] ?? "";

describe("times", () => {
  test("a time is typed as seconds or as minutes and seconds", () => {
    expect(parseSeconds("75.5")).toBe(75.5);
    expect(parseSeconds(" 1:15.5 ")).toBe(75.5);
    expect(parseSeconds("12:03")).toBe(723);
    expect(parseSeconds("")).toBeNull();
    for (const text of ["1:75", "-3", "a", "1:2:3", "1:", "Infinity"]) {
      expect(parseSeconds(text), text).toBeNaN();
    }
  });

  test("a time is shown as minutes and seconds to the hundredth, and reads back the same", () => {
    expect(formatSeconds(75.5)).toBe("1:15.50");
    expect(formatSeconds(3.004)).toBe("0:03.00");
    expect(formatSeconds(3599.999)).toBe("60:00.00");
    for (const seconds of [0, 9.99, 61.25, 1800.5]) {
      expect(parseSeconds(formatSeconds(seconds))).toBe(seconds);
    }
  });
});

describe("readRegion", () => {
  const duration = 600;

  test("reads the four fields into a region", () => {
    const read = readRegion(
      getter({
        [REGION_INPUT.start]: "1:00",
        [REGION_INPUT.end]: "90.25",
        [REGION_INPUT.label]: " the swell ",
        [REGION_INPUT.note]: "slow rise",
      }),
      duration,
    );
    expect(read).toEqual({
      ok: true,
      region: { startSeconds: 60, endSeconds: 90.25, label: "the swell", note: "slow rise" },
    });
  });

  test("names what is wrong in plain words", () => {
    /** @param {Record<string, string>} values */
    const message = (values) => {
      const read = readRegion(getter({ [REGION_INPUT.label]: "a", ...values }), duration);
      return read.ok ? null : read.message;
    };
    expect(message({ [REGION_INPUT.start]: "", [REGION_INPUT.end]: "4" })).toMatch(/start/i);
    expect(message({ [REGION_INPUT.start]: "1:7x", [REGION_INPUT.end]: "4" })).toMatch(/start/i);
    expect(message({ [REGION_INPUT.start]: "4", [REGION_INPUT.end]: "2" })).toMatch(/after/);
    expect(message({ [REGION_INPUT.start]: "4", [REGION_INPUT.end]: "4.5" })).toMatch(/at least/);
    expect(message({ [REGION_INPUT.start]: "0", [REGION_INPUT.end]: "400" })).toMatch(/at most/);
    expect(message({ [REGION_INPUT.start]: "590", [REGION_INPUT.end]: "601" })).toMatch(
      /past the end/,
    );
    const noLabel = readRegion(
      getter({ [REGION_INPUT.start]: "1", [REGION_INPUT.end]: "4", [REGION_INPUT.label]: " " }),
      duration,
    );
    expect(noLabel).toEqual({ ok: false, message: expect.stringMatching(/label/i) });
  });

  test("its checks are the domain's, which the server runs on the same numbers", () => {
    expect(regionProblem(0, REGION_SECONDS.min, 60)).toBeNull();
    expect(regionProblem(0, REGION_SECONDS.max, REGION_SECONDS.max)).toBeNull();
    expect(regionProblem(0, REGION_SECONDS.max + 0.01, 1000)).toMatch(/at most/);
  });

  test("a saved region fills the form with the values it reads back", () => {
    const region = { startSeconds: 61.25, endSeconds: 75, label: "hiss", note: "" };
    expect(readRegion(getter(regionValues(region)), duration)).toEqual({ ok: true, region });
  });
});

describe("milliseconds", () => {
  test("a region is read and sent to the millisecond, which the audio route's query takes", () => {
    const span = { startSeconds: 1 / 3, endSeconds: 4 + 2 / 3 };
    expect(spanQuery(span)).toBe("start=0.333&end=4.667");
    expect(spanQuery({ startSeconds: 61.23456789, endSeconds: 70 })).toBe("start=61.235&end=70");
    const read = readRegion(
      getter({
        [REGION_INPUT.start]: "1:01.2345",
        [REGION_INPUT.end]: "70.0004",
        [REGION_INPUT.label]: "a",
      }),
      600,
    );
    expect(read).toMatchObject({ ok: true, region: { startSeconds: 61.235, endSeconds: 70 } });
  });
});

describe("dragRegion", () => {
  test("a drag either way across the strip gives the region under it, to the hundredth", () => {
    expect(dragRegion(100, 300, 1000, 600)).toEqual({ startSeconds: 60, endSeconds: 180 });
    expect(dragRegion(300, 100, 1000, 600)).toEqual({ startSeconds: 60, endSeconds: 180 });
    expect(dragRegion(1, 2, 3, 10)).toEqual({ startSeconds: 3.33, endSeconds: 6.67 });
  });

  test("a drag past either edge stops at the edge", () => {
    expect(dragRegion(-50, 1200, 1000, 600)).toEqual({ startSeconds: 0, endSeconds: 600 });
  });
});

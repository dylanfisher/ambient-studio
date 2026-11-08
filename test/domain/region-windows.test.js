import { describe, expect, test } from "vitest";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { regionWindows } from "../../src/domain/region-windows.js";

const RATE = 48000;
const WINDOW = EXCERPT_SECONDS * RATE;

describe("regionWindows", () => {
  test("a 60 s region is read on excerpt-long windows hopped by half a window, the last ending at its end", () => {
    const windows = regionWindows(60 * RATE, RATE);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    expect(windows.map(({ start }) => start / RATE)).toEqual([0, 12.5, 25, 35]);
    for (const { length } of windows) expect(length).toBe(WINDOW);
  });

  test("a region the hops end exactly gets no extra window", () => {
    expect(regionWindows(50 * RATE, RATE).map(({ start }) => start / RATE)).toEqual([0, 12.5, 25]);
  });

  test("a 15 s region, shorter than a window, is one window read whole", () => {
    expect(regionWindows(15 * RATE, RATE)).toEqual([{ start: 0, length: 15 * RATE }]);
  });

  test("a region exactly one window long is that window", () => {
    expect(regionWindows(WINDOW, RATE)).toEqual([{ start: 0, length: WINDOW }]);
  });

  test("no frames throws", () => {
    expect(() => regionWindows(0, RATE)).toThrow(/frames/);
  });
});

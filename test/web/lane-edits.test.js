// The macro lanes' editor (decision 0065), with no DOM: each action a key, a button, a field or a
// drag runs makes a new arrangement and leaves the one it was given as it was; a lane is made by
// its first point and goes with its last; the first point never names a curve.
/** @import { Arrangement } from "../../src/domain/arrangement-schema.js" */
import { describe, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { LANE_OFFSET } from "../../src/domain/lane-schema.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import { CURVES } from "../../src/engine/trajectory.js";
import {
  addPoint,
  LANE_ADD_SECONDS,
  LANE_OFFSET_STEP,
  LANE_TIME_STEP,
  lanePoints,
  movePoint,
  nextPointCurve,
  removePoint,
  setPoint,
} from "../../src/web/lane-edits.js";
import { LANE_KEYS } from "../../src/web/lane-keys.js";
import { dragOffset, laneLayout, laneText, pointText } from "../../src/web/lane-layout.js";
import { keyLabel } from "../../src/web/quick-ab-keys.js";

const LENGTH = 120;
const LANED = /** @type {Arrangement} */ (
  Object.freeze({
    ...emptyArrangement(),
    lanes: [
      {
        macro: "brightness",
        points: [
          [0, 0],
          [40, 0.25, "smooth"],
          [100, -0.5, "linear"],
        ],
      },
    ],
  })
);
const frozen = structuredClone(LANED);

describe("lane edits", () => {
  test("a macro with no lane has no points, and its first point makes the lane at 0 s", () => {
    expect(lanePoints(emptyArrangement(), "motion")).toEqual([]);
    const made = addPoint(LANED, "motion", null, LENGTH);
    expect(made.index).toBe(0);
    expect(lanePoints(made.arrangement, "motion")).toEqual([[0, 0]]);
    // Lanes are listed in the schema's order of macros, whatever order they were made in.
    const order = Object.keys(MACROS);
    const macros = made.arrangement.lanes.map(({ macro }) => macro);
    expect(macros).toEqual([...macros].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(LANED).toEqual(frozen);
  });

  test("a point is added halfway to the next, or past the last, at the lane's value there", () => {
    const between = addPoint(LANED, "brightness", 0, LENGTH);
    expect(between.index).toBe(1);
    expect(lanePoints(between.arrangement, "brightness")[1]).toEqual([20, 0.13, "linear"]);
    const past = addPoint(LANED, "brightness", 2, LENGTH);
    expect(past.index).toBe(3);
    expect(lanePoints(past.arrangement, "brightness")[3]).toEqual([
      Math.min(LENGTH, 100 + LANE_ADD_SECONDS),
      -0.5,
      "linear",
    ]);
    // At the track's end there is no room after the last point.
    const full = addPoint(past.arrangement, "brightness", 3, LENGTH);
    expect(full.arrangement).toBe(past.arrangement);
    expect(LANED).toEqual(frozen);
  });

  test("removing the first point drops the next one's curve, and the last removes the lane", () => {
    const first = removePoint(LANED, "brightness", 0);
    expect(lanePoints(first.arrangement, "brightness")).toEqual([
      [40, 0.25],
      [100, -0.5, "linear"],
    ]);
    expect(first.index).toBe(0);
    const last = removePoint(LANED, "brightness", 2);
    expect(last.index).toBe(1);
    let emptied = LANED;
    for (let i = 0; i < 3; i++) emptied = removePoint(emptied, "brightness", 0).arrangement;
    expect(emptied.lanes).toEqual([]);
    expect(removePoint(emptied, "brightness", 0).index).toBeNull();
    expect(LANED).toEqual(frozen);
  });

  test("a field sets a point's time or offset as typed, even out of order", () => {
    const set = setPoint(LANED, "brightness", 1, { time: 120, offset: 0.4 });
    expect(lanePoints(set, "brightness")[1]).toEqual([120, 0.4, "smooth"]);
  });

  test("a step or a drag moves a point, stopping at its neighbors and the offset's range", () => {
    const later = movePoint(LANED, "brightness", 1, { seconds: LANE_TIME_STEP, offset: 0 });
    expect(lanePoints(later, "brightness")[1]).toEqual([40 + LANE_TIME_STEP, 0.25, "smooth"]);
    const up = movePoint(LANED, "brightness", 1, { seconds: 0, offset: LANE_OFFSET_STEP });
    expect(lanePoints(up, "brightness")[1]).toEqual([40, 0.3, "smooth"]);
    const far = movePoint(LANED, "brightness", 1, { seconds: 500, offset: 9 });
    expect(lanePoints(far, "brightness")[1]).toEqual([99.9, LANE_OFFSET.max, "smooth"]);
    const back = movePoint(LANED, "brightness", 1, { seconds: -500, offset: -9 });
    expect(lanePoints(back, "brightness")[1]).toEqual([0.1, LANE_OFFSET.min, "smooth"]);
    const start = movePoint(LANED, "brightness", 0, { seconds: -5, offset: 0 });
    expect(lanePoints(start, "brightness")[0]).toEqual([0, 0]);
    expect(LANED).toEqual(frozen);
  });

  test("a point's curve steps through 0007's order; the first point has none", () => {
    const names = Object.keys(CURVES);
    let arrangement = /** @type {any} */ (LANED);
    const seen = [];
    for (let i = 0; i < names.length; i++) {
      arrangement = nextPointCurve(arrangement, "brightness", 1);
      seen.push(lanePoints(arrangement, "brightness")[1]?.[2]);
    }
    expect(seen.at(-1)).toBe("smooth");
    expect(new Set(seen)).toEqual(new Set(names));
    expect(nextPointCurve(LANED, "brightness", 0)).toEqual(LANED);
  });
});

describe("lane layout", () => {
  test("points are placed by track time across and by offset down, 0.5 at the top", () => {
    const { dots, line } = laneLayout(lanePoints(LANED, "brightness"), LENGTH);
    expect(dots).toEqual([
      { left: 0, top: 50 },
      { left: 33.333333, top: 25 },
      { left: 83.333333, top: 100 },
    ]);
    // The line runs from the track's start to its end, holding past the last point.
    expect(line.startsWith("0,50 ")).toBe(true);
    expect(line.endsWith(" 100,100")).toBe(true);
    expect(laneLayout([], LENGTH)).toEqual({ dots: [], line: "0,50 100,50" });
  });

  test("a drag down lowers the offset by the share of the lane's height", () => {
    expect(dragOffset(30, 60)).toBe(-0.5);
    expect(dragOffset(-6, 60)).toBe(0.1);
    expect(dragOffset(5, 0)).toBe(0);
  });

  test("a lane and a point say what they do in words", () => {
    expect(laneText("brightness", [])).toMatch(/no points/);
    expect(laneText("brightness", lanePoints(LANED, "brightness"))).toMatch(/3 points/);
    expect(pointText("brightness", lanePoints(LANED, "brightness"), 1)).toBe(
      "Point 2 of 3, at 0:40 of the track: +0.25, brighter. Into it: easing in and out.",
    );
    expect(pointText("brightness", lanePoints(LANED, "brightness"), 2)).toMatch(/-0\.50, darker/);
    expect(pointText("brightness", lanePoints(LANED, "brightness"), 0)).toMatch(/no change/);
  });
});

test("the lane buttons show the arrows as arrows", () => {
  expect(keyLabel(LANE_KEYS.lanePrevious)).toBe("↑");
  expect(keyLabel(LANE_KEYS.laneNext)).toBe("↓");
});

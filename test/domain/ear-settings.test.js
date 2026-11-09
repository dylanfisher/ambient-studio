// What a rating of the best against a new point tells preferential BO (decision 0055), and how
// the owner's steering becomes its reach and drift (0075).
import { expect, test } from "vitest";
import {
  checkSteering,
  EAR_SCORE,
  EAR_VARIATION,
  earScore,
  earSettings,
} from "../../src/domain/ear-settings.js";

test("the new point's side winning is a win, the other side's a loss, a tie half, a skip nothing", () => {
  expect(earScore("a", "a")).toBe(EAR_SCORE.win);
  expect(earScore("b", "b")).toBe(EAR_SCORE.win);
  expect(earScore("b", "a")).toBe(EAR_SCORE.loss);
  expect(earScore("a", "b")).toBe(EAR_SCORE.loss);
  expect(earScore("tie", "a")).toBe(EAR_SCORE.tie);
  expect(earScore("skip", "b")).toBeNull();
  expect(EAR_SCORE).toEqual({ win: 1, tie: 0.5, loss: 0 });
});

const PATHS = ["brightness", "space", "warmth"];

test("steering becomes the variation's reach and a drift per path, 0 where the shift names none", () => {
  expect(earSettings({ variation: "wider", shift: { space: 0.5 } }, PATHS)).toEqual({
    reach: EAR_VARIATION.wider,
    drift: [0, 0.5, 0],
  });
});

test("a checked steering keeps its variation and drops a shift of 0", () => {
  expect(checkSteering("subtle", { brightness: -1, space: 0 }, PATHS)).toEqual({
    ok: true,
    steering: { variation: "subtle", shift: { brightness: -1 } },
  });
});

test.each([
  ["huge", {}, /^variation must be one of subtle, medium, wide, wider/],
  ["wide", [], /^shift must be an object/],
  ["wide", { density: 0.5 }, /names density, which this search doesn't move/],
  ["wide", { space: 1.5 }, /space must be a number from -1 to 1, got 1.5/],
  ["wide", { space: "up" }, /space must be a number from -1 to 1/],
])("steering %s with %j is refused", (variation, shift, message) => {
  const checked = checkSteering(variation, shift, PATHS);
  expect(!checked.ok && checked.error).toMatch(message);
});

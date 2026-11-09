// Which sections Develop every section asks the model for (decision 0082): each section in
// order, except one the owner already developed unless they ask again, a bridge, and one too
// short to develop.
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { DEVELOP_PLAN, developPlan } from "../../src/domain/develop-plan.js";

const section = (/** @type {number} */ seconds, /** @type {number | null} */ developmentId) => ({
  sketchId: 1,
  offset: 0,
  seconds,
  text: "",
  developmentId,
});

const arrangement = {
  ...emptyArrangement(),
  sections: [
    section(120, null),
    section(120, 4),
    section(30, null),
    section(120, 9),
    section(30, 4),
    section(60, null),
  ],
  transitions: Array.from({ length: 5 }, () => ({ kind: "crossfade", seconds: 8, text: "" })),
};
const isBridge = (/** @type {number} */ id) => id === 9;

test("develops each section in order, keeping developed ones and bridges, skipping short ones", () => {
  expect(developPlan(arrangement, false, isBridge)).toEqual([
    DEVELOP_PLAN.develop,
    DEVELOP_PLAN.kept,
    DEVELOP_PLAN.short,
    DEVELOP_PLAN.bridge,
    DEVELOP_PLAN.kept,
    DEVELOP_PLAN.develop,
  ]);
});

test("asked again, a developed section is developed again, but a bridge is kept", () => {
  expect(developPlan(arrangement, true, isBridge)).toEqual([
    DEVELOP_PLAN.develop,
    DEVELOP_PLAN.develop,
    DEVELOP_PLAN.short,
    DEVELOP_PLAN.bridge,
    // Shortened under 60 s after it was developed: it can't be developed again.
    DEVELOP_PLAN.short,
    DEVELOP_PLAN.develop,
  ]);
});

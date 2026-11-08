// The brief page's choices for the map's axes (decision 0057), with no DOM.
import { expect, test } from "vitest";
import {
  axesLine,
  axisChoices,
  chosenAxes,
  NO_AXIS,
  SUGGESTED_AXES,
} from "../../src/web/axis-choices.js";

const choices = axisChoices(
  [{ id: 4, near: null, far: "underwater" }],
  [{ regionId: 9, label: "dawn hum" }],
);

test("every ranged feature, macro, direction and attached region is offered, the suggestion among them", () => {
  const values = choices.map(({ value }) => value);
  expect(values).toContain("feature:centroidMean");
  expect(values).not.toContain("feature:truePeak");
  expect(values).toContain("macro:tension");
  expect(values).toContain("direction:4");
  expect(values).toContain("region:9");
  for (const value of SUGGESTED_AXES) expect(values).toContain(value);
  expect(choices.find(({ value }) => value === "direction:4")?.text).toBe(
    "the brief's description to “underwater”",
  );
});

test("the body names two or three different axes, the third optional", () => {
  expect(chosenAxes(["feature:centroidMean", "direction:4", NO_AXIS], choices)).toEqual({
    axes: [
      { source: "feature", name: "centroidMean" },
      { source: "direction", directionId: 4 },
    ],
  });
  expect(chosenAxes(["macro:motion", "region:9", "feature:flatness"], choices)).toEqual({
    axes: [
      { source: "macro", name: "motion" },
      { source: "region", regionId: 9 },
      { source: "feature", name: "flatness" },
    ],
  });
  expect(chosenAxes(["macro:motion", NO_AXIS, NO_AXIS], choices)).toBe(
    "Choose at least the first two axes.",
  );
  expect(chosenAxes(["macro:motion", "macro:motion", NO_AXIS], choices)).toBe(
    "Choose a different thing for each axis.",
  );
});

test("the line says what the map is on, or that no axes are chosen", () => {
  expect(
    axesLine(
      [
        { source: "feature", name: "centroidMean" },
        { source: "region", regionId: 9 },
      ],
      choices,
    ),
  ).toBe("The map is on spectral centroid (Hz) by nearness to the region “dawn hum”.");
  expect(axesLine([], choices)).toMatch(/^No axes chosen yet/);
});

// A map axis in plain words (decision 0057), and the explore direction toward either end.
import { expect, test } from "vitest";
import { AXIS_SOURCE } from "../../src/domain/attachment-kind.js";
import { axisName, towardText } from "../../src/domain/axis-words.js";
import { DIRECTION_CHARS } from "../../src/domain/explore-direction.js";

test("each source names its axis and the way toward each end", () => {
  const feature = { source: AXIS_SOURCE.feature, name: "centroidMean" };
  expect(axisName(feature)).toBe("spectral centroid (Hz)");
  expect(towardText(feature, 1)).toBe("Toward a higher spectral centroid");
  const macro = { source: AXIS_SOURCE.macro, name: "brightness" };
  expect(axisName(macro)).toBe("brightness (the macro, over the excerpt)");
  expect(towardText(macro, -1)).toBe("Toward less brightness");
  const direction = { source: AXIS_SOURCE.direction, near: null, far: "underwater" };
  expect(axisName(direction)).toBe("the brief's description to “underwater”");
  expect(towardText(direction, -1)).toBe("Toward a sound more like the brief's description");
  const region = { source: AXIS_SOURCE.region, label: "x".repeat(300) };
  expect(towardText(region, 1)).toHaveLength(DIRECTION_CHARS);
  expect(() => axisName({ source: "loudness" })).toThrow(/no axis source/);
});

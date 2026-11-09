// A map axis in plain words (decision 0057), and the explore direction toward either end.
import { expect, test } from "vitest";
import { AXIS_SOURCE } from "../../src/domain/attachment-kind.js";
import { axisName, endWords, towardText } from "../../src/domain/axis-words.js";
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

test("each end of an axis is said in words, as the way toward it says it", () => {
  const feature = { source: AXIS_SOURCE.feature, name: "centroidMean" };
  expect(endWords(feature, -1)).toBe("a lower spectral centroid");
  expect(endWords({ source: AXIS_SOURCE.macro, name: "space" }, 1)).toBe("more space");
  const direction = { source: AXIS_SOURCE.direction, near: "dry", far: "wet" };
  expect(endWords(direction, -1)).toBe("a sound more like “dry”");
  expect(endWords({ source: AXIS_SOURCE.region, label: "the swell" }, -1)).toBe(
    "a sound further from the region “the swell”",
  );
  expect(towardText(direction, 1)).toBe(`Toward ${endWords(direction, 1)}`);
  expect(() => endWords({ source: "loudness" }, 1)).toThrow(/no axis source/);
});

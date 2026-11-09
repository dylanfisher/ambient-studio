// A map cell and axis in words (decision 0086): where a cell sits on each axis, in the
// position bands, and how its elite compares with the other cells, never the numbers.
import { expect, test } from "vitest";
import { AXIS_SOURCE } from "../../src/domain/attachment-kind.js";
import {
  axisPlaceWords,
  axisSpanWords,
  cellPlaceWords,
  cellVerdictWords,
} from "../../src/domain/map-words.js";

const feature = { source: AXIS_SOURCE.feature, name: "centroidMean" };
const direction = { source: AXIS_SOURCE.direction, near: "dry", far: "wet" };

test("a bin reads as close to an end, leaning toward it, or midway, as a position does", () => {
  // Eight bins sit at 1/16, 3/16, … 15/16 of the axis.
  expect(axisPlaceWords(feature, 0, 8)).toBe("a lower spectral centroid");
  expect(axisPlaceWords(feature, 1, 8)).toBe("a lower spectral centroid");
  expect(axisPlaceWords(feature, 2, 8)).toBe("leaning toward a lower spectral centroid");
  expect(axisPlaceWords(feature, 3, 8)).toBe("midway on spectral centroid (Hz)");
  expect(axisPlaceWords(feature, 4, 8)).toBe("midway on spectral centroid (Hz)");
  expect(axisPlaceWords(feature, 5, 8)).toBe("leaning toward a higher spectral centroid");
  expect(axisPlaceWords(direction, 7, 8)).toBe("a sound more like “wet”");
  // Six bins, for three axes: 1/12, 3/12, … 11/12.
  expect(axisPlaceWords(feature, 1, 6)).toBe("leaning toward a lower spectral centroid");
  expect(axisPlaceWords(feature, 2, 6)).toBe("midway on spectral centroid (Hz)");
  expect(() => axisPlaceWords(feature, 8, 8)).toThrow(/no bin 8 of 8/);
});

test("a cell says each axis in turn, as a sentence", () => {
  expect(cellPlaceWords([0, 5], [8, 8], [feature, direction])).toBe(
    "A lower spectral centroid; leaning toward a sound more like “wet”.",
  );
  const macro = { source: AXIS_SOURCE.macro, name: "space" };
  expect(cellPlaceWords([3, 5, 0], [6, 6, 6], [feature, direction, macro])).toBe(
    "Midway on spectral centroid (Hz); a sound more like “wet”; less space.",
  );
});

test("an axis caption runs from its low end to its high end", () => {
  expect(axisSpanWords(feature, "the left", "the right")).toBe(
    "from a lower spectral centroid at the left to a higher spectral centroid at the right",
  );
});

test("a scored cell reads against the map's other scored cells", () => {
  const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(cellVerdictWords({ score: 11, misses: 0 }, others, true)).toBe(
    "The best cell on the map by your taste model.",
  );
  expect(cellVerdictWords({ score: 9.5, misses: 0 }, others, true)).toBe(
    "Your taste model scores it higher than nearly all of the map's cells.",
  );
  expect(cellVerdictWords({ score: 2.5, misses: 0 }, others, true)).toBe(
    "Your taste model scores it lower than most of the map's cells.",
  );
  expect(cellVerdictWords({ score: 5.5, misses: 0 }, [...others, null], true)).toBe(
    "Your taste model scores it about the middle of the map's cells.",
  );
  expect(cellVerdictWords({ score: 1, misses: 0 }, [null], true)).toBe(
    "The only cell on the map with a score.",
  );
});

test("with no taste model a cell is said by the brief's ranges it misses", () => {
  expect(cellVerdictWords({ score: null, misses: 0 }, [], false)).toBe(
    "Inside every one of the brief's ranges.",
  );
  expect(cellVerdictWords({ score: 2, misses: 1 }, [3], false)).toBe(
    "Misses one of the brief's ranges.",
  );
  expect(cellVerdictWords({ score: null, misses: 3 }, [], true)).toBe(
    "Misses more than one of the brief's ranges.",
  );
});

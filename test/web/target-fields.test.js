/** @import { FeatureRanges } from "../../src/domain/target-schema.js" */
import { describe, expect, test } from "vitest";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { validateTargets } from "../../src/domain/validate-targets.js";
import {
  keptTargets,
  readTargets,
  targetFields,
  targetInput,
  targetValues,
} from "../../src/web/target-fields.js";

/**
 * Reads the form's values from a plain record, the way FormData's get would.
 * @param {Record<string, string>} values
 */
const getter = (values) => (/** @type {string} */ name) => values[name] ?? "";

describe("targetFields", () => {
  test("has one field per feature in the range table, in its order, with its label and unit", () => {
    const fields = targetFields();
    expect(fields.map((field) => field.name)).toEqual(Object.keys(TARGET_FEATURES));
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));
    expect(byName.centroidMean).toMatchObject({
      label: "spectral centroid",
      unit: "Hz",
      least: 0,
      most: null,
    });
    expect(byName.lowEndShare).toMatchObject({ unit: null, least: 0, most: 1 });
  });
});

describe("readTargets", () => {
  test("an empty form is no ranges, and {} stays {}", () => {
    expect(readTargets(getter({}), {})).toEqual({});
  });

  test("reads a range with both ends, and an end left empty as open", () => {
    const softTargets = readTargets(
      getter({
        [targetInput("onsetRate", "low")]: "0.1",
        [targetInput("onsetRate", "high")]: "0.5",
        [targetInput("centroidMean", "high")]: "800",
        [targetInput("lowEndShare", "low")]: "0.45",
      }),
      {},
    );
    expect(softTargets).toEqual({
      features: { centroidMean: [null, 800], onsetRate: [0.1, 0.5], lowEndShare: [0.45, null] },
    });
    expect(validateTargets(softTargets).ok).toBe(true);
  });

  test("text that isn't a number is passed on, for the validator to name", () => {
    const softTargets = readTargets(getter({ [targetInput("flatness", "low")]: "some" }), {});
    expect(softTargets).toEqual({ features: { flatness: ["some", null] } });
    const checked = validateTargets(softTargets);
    expect(!checked.ok && checked.errors.map((e) => e.path)).toEqual(["$.features.flatness[0]"]);
  });

  test("keeps the saved keys other than the ranges, and replaces the ranges", () => {
    const saved = { clap: { toward: "rain" }, features: { flatness: [0, 0.1] } };
    expect(readTargets(getter({}), saved)).toEqual({ clap: { toward: "rain" } });
    expect(keptTargets(saved)).toEqual({ clap: { toward: "rain" } });
  });
});

test("targetValues fills the form back from stored ranges", () => {
  /** @type {FeatureRanges} */
  const ranges = { centroidMean: [null, 800], onsetRate: [0.1, 0.5] };
  const values = targetValues(ranges);
  expect(values).toEqual({
    [targetInput("centroidMean", "low")]: "",
    [targetInput("centroidMean", "high")]: "800",
    [targetInput("onsetRate", "low")]: "0.1",
    [targetInput("onsetRate", "high")]: "0.5",
  });
  expect(readTargets(getter(values), {})).toEqual({ features: ranges });
});

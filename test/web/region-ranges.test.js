/** @import { FeatureRanges } from "../../src/domain/target-schema.js" */
import { describe, expect, test } from "vitest";
import { rangeFill, regionChoiceText } from "../../src/web/region-ranges.js";
import { readTargets, targetInput, targetValues } from "../../src/web/target-fields.js";

describe("rangeFill", () => {
  /** @type {{ features: FeatureRanges, directions: number[] }} */
  const saved = { features: { centroidMean: [null, 400], onsetRate: [0, 0.2] }, directions: [1] };
  /** @type {FeatureRanges} */
  const proposed = { centroidMean: [250, 900], flatness: [0, 0.05] };

  test("fills the form with the proposal and leaves features it doesn't name as saved", () => {
    const { values } = rangeFill(proposed, saved.features);
    // The form as the page holds it: the saved values, then the fill on top.
    const form = { ...targetValues(saved.features), ...values };
    const read = readTargets((name) => form[name] ?? "", saved);
    expect(read).toEqual({
      directions: [1],
      features: { centroidMean: [250, 900], onsetRate: [0, 0.2], flatness: [0, 0.05] },
    });
  });

  test("changes no saved value: the saved ranges are what they were", () => {
    const before = structuredClone(saved);
    rangeFill(proposed, saved.features);
    expect(saved).toEqual(before);
  });

  test("says beside each filled feature what is saved now", () => {
    const { beside } = rangeFill(proposed, saved.features);
    expect(beside).toEqual({
      centroidMean: "Saved now: at most 400 Hz.",
      flatness: "Saved now: no range.",
    });
    expect(Object.keys(rangeFill(proposed, saved.features).values)).toEqual([
      targetInput("centroidMean", "low"),
      targetInput("centroidMean", "high"),
      targetInput("flatness", "low"),
      targetInput("flatness", "high"),
    ]);
  });
});

test("a region's choice names its file, label and times", () => {
  expect(
    regionChoiceText({ startSeconds: 2, endSeconds: 77.5, label: "the hum", note: "" }, "hum.wav"),
  ).toBe("hum.wav: the hum, 0:02.00 to 1:17.50");
});

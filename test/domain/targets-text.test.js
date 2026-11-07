// A vibe's feature ranges as lines of the prompt (decision 0034).
/** @import { FeatureRanges } from "../../src/domain/target-schema.js" */
import { describe, expect, test } from "vitest";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { targetsText } from "../../src/domain/targets-text.js";

describe("targetsText", () => {
  test("no ranges is no text, so the prompt leaves the section out", () => {
    expect(targetsText({})).toBe("");
  });

  test("one line a range, in the table's order, with each end as the owner wrote it", () => {
    const text = targetsText({
      onsetRate: [0.1, 0.5],
      centroidMean: [null, 800],
      lowEndShare: [0.45, null],
    });
    const [header, ...lines] = text.split("\n");
    expect(header).toMatch(/measured on each excerpt/);
    expect(lines).toEqual([
      "spectral centroid at most 800 Hz",
      "onset rate from 0.1 to 0.5 a second",
      "low-end share at least 0.45",
    ]);
  });

  test("every feature in the table can be written", () => {
    /** @type {FeatureRanges} */
    const all = Object.fromEntries(Object.keys(TARGET_FEATURES).map((name) => [name, [0, 1]]));
    const text = targetsText(all);
    for (const { feature } of Object.values(TARGET_FEATURES)) {
      expect(text).toContain(`${feature.label} from 0 to 1`);
    }
  });
});

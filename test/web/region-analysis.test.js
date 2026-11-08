import { expect, test } from "vitest";
import { analysisText } from "../../src/web/region-analysis.js";

test("says how many windows were measured, at what target, and whether the sound was analyzed", () => {
  const result = { target: -16, windows: 4, embedded: true, notEmbedded: null };
  expect(analysisText(result)).toBe(
    "Measured on 4 windows at -16 LUFS. Its sound is analyzed too.",
  );
  expect(
    analysisText({ ...result, windows: 1, embedded: false, notEmbedded: "set the folder" }),
  ).toBe("Measured on 1 window at -16 LUFS. Its sound isn't analyzed: set the folder.");
});

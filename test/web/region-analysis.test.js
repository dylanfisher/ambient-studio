import { expect, test } from "vitest";
import { analysisText, analysisWords } from "../../src/web/region-analysis.js";

const result = { target: -16, windows: 4, embedded: true, notEmbedded: null };

test("the numbers say how many windows were measured, and at what target", () => {
  expect(analysisText(result)).toBe("Measured on 4 windows at -16 LUFS.");
  expect(analysisText({ ...result, windows: 1 })).toBe("Measured on 1 window at -16 LUFS.");
});

test("the words say what the region can now be used for, and why its sound isn't analyzed", () => {
  expect(analysisWords(result)).toBe(
    "Measured the way an excerpt is, and its sound analyzed: a brief can take its ranges from this region, and a steer can aim toward it.",
  );
  expect(analysisWords({ ...result, embedded: false, notEmbedded: "set the folder" })).toBe(
    "Measured the way an excerpt is, so a brief can take its ranges from this region. Its sound isn't analyzed, so a steer can't aim toward it yet: set the folder.",
  );
  expect(analysisWords({ ...result, embedded: false, notEmbedded: null })).toMatch(
    /aim toward it yet: no reason was given\.$/,
  );
});

import { expect, test } from "vitest";
import { EAR_VARIATION } from "../../src/domain/ear-settings.js";
import {
  leanText,
  pathName,
  steeringText,
  VARIATION_LABEL,
} from "../../src/web/ear-steering-text.js";

test("every variation has a label", () => {
  expect(Object.keys(VARIATION_LABEL)).toEqual(Object.keys(EAR_VARIATION));
});

test("a macro's path is named by its macro, any other path as it is", () => {
  expect(pathName("macros.brightness")).toBe("brightness");
  expect(pathName("voices.0.params.gain")).toBe("voices.0.params.gain");
});

test("the steering line names the variation and each lean", () => {
  expect(steeringText({ variation: "wide", shift: {} })).toBe("Wide variation, with no shift.");
  expect(steeringText({ variation: "subtle", shift: { "macros.space": 0.5 } })).toBe(
    "Subtle variation, leaning toward more space.",
  );
  expect(
    steeringText({
      variation: "wider",
      shift: { "macros.brightness": -1, "macros.space": 0.5, "macros.warmth": 0.25 },
    }),
  ).toBe("Very wide variation, leaning toward less brightness, more space and more warmth.");
});

test("a slider's line says which way it leans and how far", () => {
  expect(leanText("macros.space", 0)).toBe("Leans neither way.");
  expect(leanText("macros.space", -0.25)).toBe("Leans toward less space (25%).");
  expect(leanText("macros.warmth", 1)).toBe("Leans toward more warmth (100%).");
});

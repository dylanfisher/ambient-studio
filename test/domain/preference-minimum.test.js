// The minimum a vibe needs before its taste model is tested (decision 0045).
import { expect, test } from "vitest";
import { PREFERENCE_MINIMUM, shortfall } from "../../src/domain/preference-minimum.js";

test("is null at the minimum and above it", () => {
  expect(shortfall(PREFERENCE_MINIMUM.pairs, PREFERENCE_MINIMUM.sessions)).toBeNull();
  expect(shortfall(90, 5)).toBeNull();
});

test("names how many more pairs and sessions are needed", () => {
  expect(shortfall(0, 0)).toEqual({ pairs: 40, sessions: 3 });
  expect(shortfall(52, 2)).toEqual({ pairs: 0, sessions: 1 });
  expect(shortfall(39, 3)).toEqual({ pairs: 1, sessions: 0 });
});

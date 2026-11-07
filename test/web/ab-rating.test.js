// What an A/B rating sends (decisions 0027 and 0048): the pair's sides and logged seed, the
// outcome for the side chosen on screen, and each side's played share by the side it is of.
import { expect, test } from "vitest";
import { abRatingBody, chosenOutcome } from "../../src/web/ab-rating.js";

const PAIR = { a: 31, b: 32, orderSeed: 77, leftSide: /** @type {const} */ ("b") };

test("choosing a side on screen gives the outcome of the pair's side shown there", () => {
  expect(chosenOutcome(PAIR, "left")).toBe("b");
  expect(chosenOutcome(PAIR, "right")).toBe("a");
  expect(chosenOutcome({ ...PAIR, leftSide: "a" }, "left")).toBe("a");
});

test("the body names the pair, its seed, and each side's played share by its side", () => {
  const body = abRatingBody(PAIR, "b", { left: 0.9, right: 0.25 }, 4200);
  expect(body).toEqual({
    a: 31,
    b: 32,
    orderSeed: 77,
    outcome: "b",
    aPlayedFraction: 0.25,
    bPlayedFraction: 0.9,
    timeTakenMs: 4200,
  });
  expect(
    abRatingBody({ ...PAIR, leftSide: "a" }, "tie", { left: 0.9, right: 0.25 }, 1),
  ).toMatchObject({ aPlayedFraction: 0.9, bPlayedFraction: 0.25 });
});

import { expect, test } from "vitest";
import { operatorLabel } from "../../src/domain/operator-label.js";

test("operatorLabel names each operator in a word, and refuses one it doesn't know", () => {
  expect([null, "revise", "nudge", "explore", "optimize"].map(operatorLabel)).toEqual([
    "first try",
    "revised",
    "nudged",
    "variation",
    "searched",
  ]);
  expect(() => operatorLabel("optimize-control")).toThrow(/optimize-control/);
  expect(() => operatorLabel("revise-control")).toThrow(/revise-control/);
});

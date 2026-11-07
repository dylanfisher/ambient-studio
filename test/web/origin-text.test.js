import { describe, expect, test } from "vitest";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { intentText, operatorLabel, originText, rejectText } from "../../src/web/origin-text.js";

/** @param {number} id */
const nameOf = (id) => `candidate ${id}`;

/** @param {Record<string, unknown>} rest */
const candidate = (rest) => ({
  operator: null,
  operatorParams: null,
  parentIds: [],
  intent: null,
  rejectReason: null,
  ...rest,
});

describe("originText", () => {
  test("says how each operator made the candidate, naming its parent", () => {
    expect(originText(candidate({}), nameOf)).toBe("A first try from the model.");
    expect(originText(candidate({ operator: "revise", parentIds: [3] }), nameOf)).toBe(
      "The model's revision of candidate 3, after its excerpt missed a range or a check.",
    );
    expect(
      originText(
        candidate({ operator: "nudge", parentIds: [3], operatorParams: { stepSize: "medium" } }),
        nameOf,
      ),
    ).toBe("A medium nudge of candidate 3: its numbers moved, with no model request.");
    expect(
      originText(
        candidate({ operator: "explore", parentIds: [3], operatorParams: { direction: null } }),
        nameOf,
      ),
    ).toBe("The model's variation of candidate 3.");
  });

  test("quotes an explore's direction as the owner wrote it, and says when the base was trimmed", () => {
    const text = originText(
      candidate({
        operator: "explore",
        parentIds: [3],
        operatorParams: { direction: "<b>slower</b>", baseTrimmed: true },
      }),
      nameOf,
    );
    expect(text).toBe(
      "The model's variation of candidate 3, toward “<b>slower</b>”. The base didn't fit in the model's context, so the model never read it: this is a plain first try.",
    );
  });

  test("an operator the page doesn't know is an error", () => {
    expect(() => originText(candidate({ operator: "crossover" }), nameOf)).toThrow(/crossover/);
  });
});

test("operatorLabel names each operator in a word, and refuses one it doesn't know", () => {
  expect([null, "revise", "nudge", "explore"].map(operatorLabel)).toEqual([
    "first try",
    "revised",
    "nudged",
    "variation",
  ]);
  expect(() => operatorLabel("revise-control")).toThrow(/revise-control/);
});

describe("intentText", () => {
  test("a nudge child has no intent of its own and says so, unlike a model answer", () => {
    expect(intentText(candidate({ intent: "a slow drone" }))).toBe("a slow drone");
    expect(intentText(candidate({ operator: "nudge" }))).toBe(
      "A nudge has no intent of its own: it is its base with some numbers moved.",
    );
    expect(intentText(candidate({}))).toBe("The model gave no intent.");
  });
});

describe("rejectText", () => {
  test("a nudge draw's reason reads as a draw, not as a model answer", () => {
    expect(rejectText(candidate({ operator: "nudge", rejectReason: REJECT_REASON.repeated }))).toBe(
      "a nudge draw that landed on a genome already made, so it was drawn again",
    );
    expect(
      rejectText(candidate({ operator: "nudge", rejectReason: REJECT_REASON.lintErrors })),
    ).toBe("a nudge draw that broke the brief's rules, so it was drawn again");
    expect(rejectText(candidate({ rejectReason: REJECT_REASON.noJson }))).toBe(
      "a model answer with no JSON in it",
    );
  });

  test("every reject reason has words, for a draw and for an answer", () => {
    for (const reason of Object.values(REJECT_REASON)) {
      for (const operator of [null, "nudge"]) {
        expect(rejectText(candidate({ operator, rejectReason: reason }))).toMatch(/^a /);
      }
    }
  });
});

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

  test("a search point names its base, generation and point, and its score once scored", () => {
    const point = candidate({
      operator: "optimize",
      parentIds: [3],
      operatorParams: { generation: 2, point: 4 },
    });
    expect(originText({ ...point, search: { shown: true, score: -0.25 } }, nameOf)).toBe(
      "Point 5 of generation 3 of a search from candidate 3, scored by your taste model with no model request. Shown as one of the search's best: search score -0.25.",
    );
    expect(originText({ ...point, search: { shown: false, score: null } }, nameOf)).toBe(
      "Point 5 of generation 3 of a search from candidate 3, scored by your taste model with no model request.",
    );
  });

  test("a steer point names its base, generation and point, and is a search point otherwise", () => {
    const point = candidate({
      operator: "steer",
      parentIds: [3],
      operatorParams: { generation: 0, point: 1 },
    });
    expect(originText({ ...point, search: { shown: true, score: -1.5 } }, nameOf)).toBe(
      "Point 2 of generation 1 of a steer from candidate 3, scored by where it sits on the sliders and regions chosen, with no model request. Shown as one of the steer's best: steer score -1.50.",
    );
    expect(operatorLabel("steer")).toBe("steered");
    expect(intentText(candidate({ operator: "steer" }))).toBe(
      "A search point has no intent of its own: it is its base with some numbers moved.",
    );
    expect(rejectText(candidate({ operator: "steer", rejectReason: REJECT_REASON.repeated }))).toBe(
      "a search point that landed on a genome already made, so it was told a low score",
    );
  });

  test("a map fill's child is a nudge of the elite it started from", () => {
    const child = candidate({
      operator: "elite",
      parentIds: [3],
      operatorParams: { stepSize: "medium" },
    });
    expect(originText(child, nameOf)).toBe(
      "A medium nudge of candidate 3, the best in a cell beside an empty one on the brief's map, made by filling the map with no model request.",
    );
    expect(operatorLabel("elite")).toBe("map fill");
    expect(intentText(child)).toBe(
      "A nudge has no intent of its own: it is its base with some numbers moved.",
    );
    expect(rejectText({ ...child, rejectReason: REJECT_REASON.repeated })).toBe(
      "a nudge draw that landed on a genome already made, so it was drawn again",
    );
  });

  test("a search-by-ear point names its pair and base, and says when it is the best", () => {
    const point = candidate({
      operator: "optimize-ear",
      parentIds: [3],
      operatorParams: { query: 6 },
    });
    expect(originText({ ...point, search: { shown: false, score: null } }, nameOf)).toBe(
      "Pair 7 of a search by ear from candidate 3: you compared it with the best so far.",
    );
    expect(originText({ ...point, search: { shown: true, score: null } }, nameOf)).toBe(
      "Pair 7 of a search by ear from candidate 3: you compared it with the best so far. Shown as the search's best: the one you chose last.",
    );
    expect(operatorLabel("optimize-ear")).toBe("searched by ear");
    expect(
      rejectText(candidate({ operator: "optimize-ear", rejectReason: REJECT_REASON.repeated })),
    ).toBe(
      "a search-by-ear point that landed on a genome already made, so it was told as a loss and never played",
    );
  });

  test("an operator the page doesn't know is an error", () => {
    expect(() => originText(candidate({ operator: "crossover" }), nameOf)).toThrow(/crossover/);
  });
});

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

describe("intentText", () => {
  test("a nudge child has no intent of its own and says so, unlike a model answer", () => {
    expect(intentText(candidate({ intent: "a slow drone" }))).toBe("a slow drone");
    expect(intentText(candidate({ operator: "nudge" }))).toBe(
      "A nudge has no intent of its own: it is its base with some numbers moved.",
    );
    expect(intentText(candidate({}))).toBe("The model gave no intent.");
    expect(intentText(candidate({ operator: "optimize" }))).toBe(
      "A search point has no intent of its own: it is its base with some numbers moved.",
    );
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
    expect(
      rejectText(candidate({ operator: "optimize", rejectReason: REJECT_REASON.lintErrors })),
    ).toBe("a search point that broke the brief's rules, so it was told a low score");
    expect(rejectText(candidate({ rejectReason: REJECT_REASON.noJson }))).toBe(
      "a model answer with no JSON in it",
    );
  });

  test("every reject reason has words, for a draw and for an answer", () => {
    for (const reason of Object.values(REJECT_REASON)) {
      for (const operator of [null, "nudge", "optimize"]) {
        expect(rejectText(candidate({ operator, rejectReason: reason }))).toMatch(/^a /);
      }
    }
  });
});

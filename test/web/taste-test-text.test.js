// The taste model test's report in plain words (decisions 0032 and 0045).
import { describe, expect, test } from "vitest";
import {
  agreementText,
  tasteFacts,
  tasteSummary,
  tasteVerdict,
} from "../../src/web/taste-test-text.js";

const short = {
  pairs: 0,
  ties: 0,
  thumbs: 0,
  sessions: 0,
  noFeatures: 0,
  noSound: null,
  shortfall: { pairs: 40, sessions: 3 },
  test: null,
};

/** @param {number} agreed @param {number} scored @param {number} low @param {number} high */
const found = (agreed, scored, low, high) => ({
  agreement: { agreed, scored, share: agreed / scored, low, high },
  unscored: 0,
});

describe("tasteSummary", () => {
  test("a brief with no ratings has no model yet", () => {
    expect(tasteSummary(short)).toBe(
      "Not enough data: no ratings yet, so there is no model yet. The test needs 40 A/B choices over at least 3 sessions.",
    );
  });

  test("thumbs alone are not enough, and it says why", () => {
    expect(tasteSummary({ ...short, thumbs: 8 })).toBe(
      "Not enough data: 8 thumbs but no A/B choices, and the test scores A/B choices. It needs 40 A/B choices over at least 3 sessions.",
    );
  });

  test("names the pairs and sessions still needed", () => {
    expect(
      tasteSummary({ ...short, pairs: 12, sessions: 1, shortfall: { pairs: 28, sessions: 2 } }),
    ).toBe(
      "Not enough data: 12 A/B choices over 1 session. It needs 28 more, over at least 2 more sessions.",
    );
    expect(
      tasteSummary({ ...short, pairs: 52, sessions: 2, shortfall: { pairs: 0, sessions: 1 } }),
    ).toBe("Not enough data: 52 A/B choices over 2 sessions. It needs at least 1 more session.");
  });

  test("says what was left out", () => {
    expect(
      tasteSummary({
        ...short,
        pairs: 30,
        sessions: 3,
        noFeatures: 2,
        noSound: 5,
        shortfall: { pairs: 10, sessions: 0 },
      }),
    ).toBe(
      "Not enough data: 30 A/B choices over 3 sessions. It needs 10 more. 5 more are left out until their sound is analyzed (run the embed job), and 2 because they were heard under an older engine.",
    );
  });

  test("a tested brief reads its agreement", () => {
    const tested = {
      ...short,
      pairs: 43,
      sessions: 3,
      shortfall: null,
      test: {
        folds: [],
        scored: 41,
        ties: 1,
        leaked: 1,
        model: found(29, 41, 0.5, 0.857),
        featuresOnly: found(12, 41, 0.14, 0.5),
        alwaysLeft: found(21, 41, 0.45, 0.55),
        louder: found(20, 41, 0.4, 0.6),
      },
    };
    expect(tasteSummary(tested)).toBe(
      "On sessions it hadn't learned from, the model picked your choice 71% of the time (29 of 41), probably between 50% and 86%.",
    );
    expect(tasteFacts(tested)).toEqual([
      ["The model", "71% of 41, probably between 50% and 86%"],
      ["Features only, without the sound analysis", "29% of 41, probably between 14% and 50%"],
      ["Always the left one", "51% of 41, probably between 45% and 55%"],
      ["The louder one", "49% of 41, probably between 40% and 60%"],
      ["Left out", "1 about the same; 1 whose candidate was also rated in another session"],
    ]);
  });
});

describe("tasteVerdict", () => {
  const tested = (/** @type {any} */ model) => ({
    ...short,
    shortfall: null,
    test: { model },
  });

  test("too little data says what more it needs, with no counts", () => {
    expect(tasteVerdict(short)).toBe(
      "Not enough data yet: the test needs more A/B choices, over more sessions.",
    );
    expect(tasteVerdict({ ...short, shortfall: { pairs: 10, sessions: 0 } })).toBe(
      "Not enough data yet: the test needs more A/B choices.",
    );
    expect(tasteVerdict({ ...short, shortfall: { pairs: 0, sessions: 1 } })).toBe(
      "Not enough data yet: the test needs A/B choices from more sessions.",
    );
  });

  test("the agreement's interval against chance gives the verdict", () => {
    expect(tasteVerdict(tested(found(32, 41, 0.62, 0.88)))).toBe(
      "The model picks your choice most of the time, more often than chance.",
    );
    expect(tasteVerdict(tested(found(25, 41, 0.51, 0.75)))).toBe(
      "The model picks your choice more often than chance, though not by much.",
    );
    expect(tasteVerdict(tested(found(29, 41, 0.5, 0.857)))).toBe(
      "The model can't yet be told apart from a coin toss; more A/B choices will tell.",
    );
    expect(tasteVerdict(tested(found(10, 41, 0.12, 0.4)))).toBe(
      "The model picks against your choice more often than chance would, so something it reads misleads it.",
    );
    expect(tasteVerdict(tested({ agreement: null, unscored: 41 }))).toBe(
      "There is no model to test yet.",
    );
  });
});

describe("agreementText", () => {
  test("a model with no terms reads no model yet", () => {
    expect(agreementText({ agreement: null, unscored: 41 })).toBe(
      "no model yet: it couldn't tell any of the 41 apart",
    );
  });

  test("nothing to score reads so", () => {
    expect(agreementText({ agreement: null, unscored: 0 })).toBe("nothing to score");
  });
});

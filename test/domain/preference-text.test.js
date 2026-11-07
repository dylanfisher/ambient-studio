// The "what you like" text (decision 0047) from hand-made model files: which weights it names,
// in which words and order, and what it says with no model, a stale one or too little data.
/** @import { ModelWeights } from "../../src/domain/preference-text.js" */
import { expect, test } from "vitest";
import { PREFERENCE_MINIMUM } from "../../src/domain/preference-minimum.js";
import { preferenceText } from "../../src/domain/preference-text.js";

const FEATURES = ["onsetRate", "stereoWidth", "flatness"];
const MACROS = ["brightness", "motion", "space"];
const ENOUGH = { pairs: PREFERENCE_MINIMUM.pairs, sessions: PREFERENCE_MINIMUM.sessions };

/**
 * A model file with two CLAP components and each term's posterior mean and standard deviation;
 * the covariance is diagonal. Terms not given are 0 ± 1. `constant` names columns whose basis
 * scale is 0.
 * @param {Record<string, [number, number]>} weights by term name
 * @param {{ constant?: string[], clap?: number }} [options]
 * @returns {ModelWeights}
 */
function model(weights, { constant = [], clap = 2 } = {}) {
  const terms = [
    ...Array.from({ length: clap }, (_, k) => `clap:${k + 1}`),
    ...FEATURES.map((name) => `feature:${name}`),
    ...MACROS.map((name) => `macro:${name}`),
    "leftBias",
    "thumbsIntercept",
  ];
  const [mean, sd] = [0, 1].map((i) => terms.map((term) => weights[term]?.[i] ?? [0, 1][i]));
  const scale = (/** @type {string} */ term) => (constant.includes(term) ? 0 : 1);
  return {
    featureNames: FEATURES,
    macroNames: MACROS,
    terms,
    mean: /** @type {number[]} */ (mean),
    covariance: terms.map((_, i) => terms.map((_, j) => (i === j ? (sd?.[i] ?? 0) ** 2 : 0))),
    basis: {
      featureScales: FEATURES.map((name) => scale(`feature:${name}`)),
      macroScales: MACROS.map((name) => scale(`macro:${name}`)),
    },
  };
}

/**
 * @param {ModelWeights} weights
 * @param {{ pairs: number, sessions: number }} [counts]
 */
const fitted = (weights, counts = ENOUGH) =>
  preferenceText({ state: "fitted", model: weights, ...counts });

test("weights with known signs give the matching phrases", () => {
  const { text } = fitted(
    model({
      "macro:brightness": [-1, 0.2],
      "feature:onsetRate": [0.8, 0.2],
      "macro:motion": [0.6, 0.2],
    }),
  );
  expect(text).toContain(
    "you prefer candidates to be darker, to have the onset rate higher, and to move more.",
  );
  const flipped = fitted(model({ "macro:space": [0.9, 0.2], "feature:stereoWidth": [-0.9, 0.3] }));
  expect(flipped.text).toContain(
    "you prefer candidates to sound more spacious and to have the stereo width lower.",
  );
});

test("a weight whose 95% interval crosses zero is left out", () => {
  // 0.5 / 0.26 is 1.92 standard deviations, inside 1.96; 0.5 / 0.25 is 2, outside.
  const { text } = fitted(model({ "macro:brightness": [0.5, 0.26], "macro:motion": [0.5, 0.25] }));
  expect(text).toContain("you prefer candidates to move more.");
  expect(text).not.toContain("brighter");
});

test("phrases are ranked by mean over standard deviation and capped at four", () => {
  const { text } = fitted(
    model({
      "feature:onsetRate": [1, 0.4], // 2.5
      "feature:stereoWidth": [0.3, 0.1], // 3
      "feature:flatness": [-2, 0.4], // 5
      "macro:brightness": [0.9, 0.2], // 4.5
      "macro:motion": [-0.5, 0.2], // 2.5, fifth by order of terms
    }),
  );
  expect(text).toContain(
    "you prefer candidates to have the spectral flatness lower, to be brighter, to have the stereo width higher, and to have the onset rate higher (the 4 clearest of 5).",
  );
  expect(text).not.toContain("stiller");
});

test("a column the basis found constant is never named", () => {
  const { text } = fitted(
    model({ "macro:brightness": [3, 0.1] }, { constant: ["macro:brightness"] }),
  );
  expect(text).not.toContain("brighter");
  expect(text).toContain("no measured feature or macro clearly matters yet");
});

test("the sound's share of the weights is given, and its components are never named", () => {
  const { text } = fitted(
    model({ "clap:1": [3, 0.1], "clap:2": [0, 1], "macro:motion": [1, 0.1] }),
  );
  // 3² of 3² + 1²: 90%.
  expect(text).toContain("About 90% of the model's weight is on the sound itself");
  expect(text).not.toMatch(/clap|component/i);
});

test("it says what it rests on", () => {
  const { text } = fitted(model({ "macro:motion": [1, 0.1] }), { pairs: 52, sessions: 4 });
  expect(text).toMatch(/^From 52 A\/B choices over 4 sessions, /);
});

test("under the minimum the text says so and names the shortfall, with no phrases", () => {
  const { text } = fitted(model({ "macro:motion": [1, 0.1] }), { pairs: 1, sessions: 1 });
  expect(text).toBe(
    `Not enough data yet: the taste model rests on 1 A/B choice over 1 session, and needs ${PREFERENCE_MINIMUM.pairs - 1} more A/B choices and ${PREFERENCE_MINIMUM.sessions - 1} more sessions before it says what you like.`,
  );
  const sessionsOnly = fitted(model({}), { pairs: 60, sessions: 2 });
  expect(sessionsOnly.text).toContain("and needs 1 more session before");
});

test("with no model, or one with no terms, it says so and how to fit one", () => {
  const none = preferenceText({ state: "none", reason: null });
  expect(none.text).toMatch(/^No taste model yet\. .*fit job/);
  const why = preferenceText({ state: "none", reason: "the config names no folder" });
  expect(why.text).toMatch(/^No taste model yet: the config names no folder\. /);
  const empty = fitted(
    model(
      {},
      {
        clap: 0,
        constant: [...FEATURES.map((n) => `feature:${n}`), ...MACROS.map((n) => `macro:${n}`)],
      },
    ),
  );
  expect(empty.text).toBe(none.text);
});

test("a stale model is never described", () => {
  const { text } = preferenceText({ state: "stale" });
  expect(text).toMatch(/^The taste model is out of date/);
  expect(text).toContain("fit job");
});

test("a term the studio has no words for fails loudly", () => {
  const weights = model({});
  weights.terms[2] = "feature:loudness";
  expect(() => fitted(weights)).toThrow("feature:loudness");
});

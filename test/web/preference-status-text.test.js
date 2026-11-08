// Where the taste model stands, in plain words (decision 0068).
import { expect, test } from "vitest";
import { formatTime } from "../../src/web/format-time.js";
import { analysisText, fitText } from "../../src/web/preference-status-text.js";

const AT = Date.UTC(2026, 10, 8, 15, 0);

test("the analysis says how many excerpts wait, or that none do", () => {
  expect(analysisText({ waiting: 0, reason: null, lastAt: null })).toBe(
    "Sound analysis: nothing to analyze yet. Rate some candidates first.",
  );
  expect(analysisText({ waiting: 0, reason: null, lastAt: AT })).toBe(
    `Sound analysis: every rated and candidate excerpt is analyzed, last ${formatTime(AT)}.`,
  );
  expect(analysisText({ waiting: 1, reason: null, lastAt: null })).toBe(
    "Sound analysis: 1 excerpt not analyzed yet. Press Analyze the sound.",
  );
  expect(analysisText({ waiting: 12, reason: null, lastAt: AT })).toBe(
    `Sound analysis: 12 excerpts not analyzed yet, last ${formatTime(AT)}. Press Analyze the sound.`,
  );
  expect(analysisText({ waiting: null, reason: "the checkpoint is gone", lastAt: AT })).toBe(
    "Sound analysis: can't say what is analyzed, because the checkpoint is gone.",
  );
});

test("the fit names the briefs whose model is out of date", () => {
  expect(fitText({ lastAt: null, briefs: [] })).toBe("Taste model: no briefs yet.");
  expect(fitText({ lastAt: null, briefs: [{ name: "Drift", state: "none" }] })).toMatch(
    /^Taste model: not fitted yet\./,
  );
  const drift = { name: "Drift", state: "fitted" };
  const briefs = [drift, { name: "Harbor", state: "stale" }, { name: "Fog", state: "stale" }];
  expect(fitText({ lastAt: AT, briefs: [drift] })).toBe(
    `Taste model: up to date for every brief, last fitted ${formatTime(AT)}.`,
  );
  expect(fitText({ lastAt: AT, briefs })).toBe(
    `Taste model: last fitted ${formatTime(AT)}, and out of date for Harbor and Fog, since ratings changed. Press Fit the taste model.`,
  );
});

// What the model test page's confirm says a test costs (decision 0040), from the count, the
// briefs, the mode and whether the model thinks.
import { expect, test } from "vitest";
import { costText } from "../../src/web/test-cost.js";

test("the owner's revision run, thinking off, reads about 27 to 40 minutes", () => {
  const text = costText({ count: 32, briefs: 3, revise: true, thinking: false });
  expect(text).toBe(
    "Ask the model for 96 candidates (32 for each of 3 briefs)? With the revision test it also renders each answer and sends each one that misses back twice: usually 2 to 3 requests per candidate, at most 6 counting fixes. That is about 27 to 40 minutes at about 7 s a request (thinking is off), longer while the live site keeps the model busy.",
  );
});

test("a plain run, thinking on, counts a first try and at most one fix per candidate", () => {
  const text = costText({ count: 16, briefs: 3, revise: false, thinking: true });
  expect(text).toBe(
    "Ask the model for 48 candidates (16 for each of 3 briefs)? It sends 1 or 2 requests per candidate, a first try and at most one fix, and makes no audio. That is about 44 to 88 minutes at about 55 s a request (thinking is on), longer while the live site keeps the model busy.",
  );
});

test("one brief reads in the singular, and a tiny run reads at least a minute", () => {
  const text = costText({ count: 1, briefs: 1, revise: false, thinking: false });
  expect(text).toMatch(/^Ask the model for 1 candidate \(1 for each of 1 brief\)\?/);
  expect(text).toContain("That is about 1 minute at about 7 s a request");
});

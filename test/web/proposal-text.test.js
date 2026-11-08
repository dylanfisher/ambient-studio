// The proposal's confirm and the share line under Propose (decision 0067).
import { expect, test } from "vitest";
import { proposalShareText, proposeCostText } from "../../src/web/proposal-text.js";

test("the confirm states the request and its time from recent requests", () => {
  const text = proposeCostText(600, { seconds: 50, timed: 20 });
  expect(text).toMatch(/^Ask the model to propose a 10:00 track\?/);
  expect(text).toContain("up to 24 sketches and map elites");
  expect(text).toContain("1 or 2 requests to the model");
  expect(text).toContain("Nothing is rendered");
  expect(text).toContain(
    "At 50 s a request, the median of the last 20 the model answered, that is about 1 to 2 minutes",
  );
  expect(proposeCostText(600, { seconds: 20, timed: 1 })).toContain(
    "the one request timed so far, that is about 1 minute,",
  );
  expect(proposeCostText(600, { seconds: null, timed: 0 })).toMatch(
    /No request to the model has been timed yet/,
  );
});

test("the share counts proposals the model answered, valid after at most one repair", () => {
  expect(proposalShareText({ asked: 0, valid: 0, firstTry: 0, invalid: 0, failed: 0 })).toBe(
    "No track has been proposed yet.",
  );
  expect(proposalShareText({ asked: 6, valid: 4, firstTry: 3, invalid: 1, failed: 1 })).toBe(
    "Proposals so far: 4 of 5 valid after at most one repair (80%), 3 on the first try; 1 still invalid. 1 more never got an answer from the model, and isn't counted.",
  );
  expect(proposalShareText({ asked: 1, valid: 0, firstTry: 0, invalid: 0, failed: 1 })).toBe(
    "Proposals so far: 0 of 0 valid after at most one repair, 0 on the first try; 0 still invalid. 1 more never got an answer from the model, and isn't counted.",
  );
});
